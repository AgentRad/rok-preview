import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/payments";
import { markOrderPaid } from "@/lib/order-utils";
import { syncSupplierConnectStatus } from "@/lib/stripe-connect";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";
// Webhook signatures verify against the raw body. Next.js gives us the raw
// stream here as long as we read it with req.text().
export const dynamic = "force-dynamic";

/**
 * Single Stripe webhook endpoint for both platform (checkout, refunds)
 * and Connect (account.updated, transfer.*) events. The owner-configured
 * webhook in Stripe should subscribe to:
 *   checkout.session.completed
 *   charge.refunded
 *   account.updated
 *   transfer.created
 *   transfer.paid
 *   transfer.failed
 *   transfer.reversed
 *
 * Idempotency: each branch is keyed off a Stripe id (transferId,
 * paymentIntentId, etc.). Stripe retries deliver the same id; our writes
 * are upserts or short-circuit on already-applied state.
 */
export async function POST(req: Request) {
  const provider = getProvider();
  if (!provider) {
    return NextResponse.json({ error: "Payments not configured." }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature") || "";
  const body = await req.text();

  let event: Awaited<ReturnType<typeof provider.parseWebhookEvent>>;
  try {
    event = await provider.parseWebhookEvent({ body, signature });
  } catch (err) {
    captureError(err, { subsystem: "payments", op: "webhook-verify" });
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (!event) return NextResponse.json({ received: true });

  try {
    switch (event.type) {
      case "session.completed":
        if (event.orderId) {
          // Capture the payment_intent before flipping to PAID so the
          // refund flow has it ready. markOrderPaid is idempotent.
          if (event.paymentIntentId) {
            await prisma.order.update({
              where: { id: event.orderId },
              data: { stripePaymentIntentId: event.paymentIntentId },
            }).catch(() => null);
          }
          await markOrderPaid(event.orderId, provider.name, event.sessionId, {
            taxCents: event.taxCents ?? 0,
            amountTotalCents: event.amountTotalCents,
          });
        }
        break;

      case "account.updated": {
        // The Connect-account id maps 1:1 to a Supplier row. Sync the
        // capability flags so the dashboard reflects the new state.
        const supplier = await prisma.supplier.findUnique({
          where: { stripeAccountId: event.accountId },
        });
        if (supplier) {
          await syncSupplierConnectStatus(supplier.id);
        }
        break;
      }

      case "transfer.paid": {
        // Find the matching Payout by transferId and mark PAID. The
        // initial insert at payout creation time set status=PROCESSING.
        const payout = await prisma.payout.findUnique({
          where: { stripeTransferId: event.transferId },
        });
        if (payout && payout.status !== "PAID") {
          await prisma.payout.update({
            where: { id: payout.id },
            data: { status: "PAID", paidAt: new Date() },
          });
        }
        break;
      }

      case "transfer.failed": {
        const payout = await prisma.payout.findUnique({
          where: { stripeTransferId: event.transferId },
        });
        if (payout && payout.status !== "PAID") {
          await prisma.payout.update({
            where: { id: payout.id },
            data: {
              status: "FAILED",
              failureReason: event.failureMessage.slice(0, 500),
            },
          });
          // Audit-log so an admin sees the failure in /admin/audit.
          await writeAuditLog({
            actor: { id: "system", email: "system@partsport" },
            action: "PAYOUT_MARKED_PAID",
            targetType: "Payout",
            targetId: payout.id,
            summary: `Payout ${payout.reference} FAILED: ${event.failureMessage}`,
            metadata: {
              transferId: event.transferId,
              destinationAccountId: event.destinationAccountId,
            },
          });
        }
        break;
      }

      case "charge.refunded": {
        // Out-of-band refunds (issued from the Stripe dashboard, not via
        // our /api/admin/orders/[id]/refund route) land here. Match by
        // payment_intent and bump Order.refundedCents to keep the totals
        // honest. Refunds created through our admin route already wrote
        // a Refund row inline, so we just record any extra delta.
        if (event.paymentIntentId) {
          const order = await prisma.order.findFirst({
            where: { stripePaymentIntentId: event.paymentIntentId },
            include: { refunds: true },
          });
          if (order) {
            const known = order.refunds.reduce(
              (sum, r) => sum + r.amountCents,
              0
            );
            const delta = event.amountRefundedCents - known;
            if (delta > 0) {
              await prisma.refund.create({
                data: {
                  orderId: order.id,
                  amountCents: delta,
                  reason: "Out-of-band Stripe refund",
                  status: "succeeded",
                },
              });
              await prisma.order.update({
                where: { id: order.id },
                data: {
                  refundedCents: event.amountRefundedCents,
                  status:
                    event.amountRefundedCents >= order.totalCents
                      ? "REFUNDED"
                      : order.status,
                },
              });
            }
          }
        }
        break;
      }

      case "ignored":
      default:
        break;
    }
  } catch (err) {
    captureError(err, { subsystem: "payments", op: `webhook-${event.type}` });
    // Return 200 anyway so Stripe doesn't keep retrying a malformed event;
    // the error is captured for admin debugging.
  }

  return NextResponse.json({ received: true });
}

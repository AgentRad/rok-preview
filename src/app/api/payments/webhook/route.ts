import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/payments";
import { markOrderPaid } from "@/lib/order-utils";
import { maybeReactivateOrg } from "@/lib/dunning";
import { applySupplierClawback } from "@/lib/refunds";
import { syncSupplierConnectStatus } from "@/lib/stripe-connect";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";
import { intuitConfigured } from "@/lib/qbo-auth";
import { syncRefund } from "@/lib/qbo-sync";

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
 *   invoice.paid                  (PLH-3z-2 net-terms collection)
 *   invoice.payment_failed        (PLH-3z-2)
 *   invoice.marked_uncollectible  (PLH-3z-2)
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
        } else {
          // P9.5 MED 29: log + capture instead of silently dropping.
          // A Connect account that we don't have on file is a real
          // signal (orphaned Stripe account, deleted Supplier row, or
          // a webhook misroute). Pre-fix this case vanished.
          captureError(
            new Error(
              `account.updated for unknown Connect account ${event.accountId}`
            ),
            { subsystem: "payments", op: "account-updated-unknown" }
          );
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
        // P9.5 CRIT 6: upsert each refund by stripeRefundId. Pre-P9.5
        // matched by sum delta, which created phantom rows on
        // out-of-order webhook replays. Stripe guarantees refund ids are
        // unique so the Refund table's @unique(stripeRefundId) is the
        // right de-dup primitive.
        if (event.paymentIntentId && event.refunds.length > 0) {
          const order = await prisma.order.findFirst({
            where: { stripePaymentIntentId: event.paymentIntentId },
          });
          if (order) {
            for (const r of event.refunds) {
              // Try insert; if the stripeRefundId is already there,
              // P2002 fires and we skip silently (Stripe replay).
              let isNew = true;
              try {
                await prisma.refund.create({
                  data: {
                    orderId: order.id,
                    stripeRefundId: r.id,
                    amountCents: r.amountCents,
                    reason: r.reason
                      ? `Out-of-band Stripe refund: ${r.reason}`
                      : "Out-of-band Stripe refund",
                    status: "succeeded",
                  },
                });
              } catch (err) {
                const code = (err as { code?: string }).code;
                if (code === "P2002") {
                  isNew = false;
                } else {
                  isNew = false;
                  captureError(err, {
                    subsystem: "payments",
                    op: "webhook-refund-upsert",
                    stripeRefundId: r.id,
                  });
                }
              }
              // PLH-1 commit 5: out-of-band Stripe refund. Run the
              // per-supplier clawback so reserve / owedToPlatformCents
              // move the same way refundOrder() would have moved them
              // if the refund had been triggered through the admin UI.
              // Gated on isNew so a Stripe webhook replay doesn't
              // double-claw a supplier's reserve.
              if (isNew) {
                try {
                  // PLH-3g P6: prefer the slot routing metadata stamped
                  // by refundOrder() so a partial scoped refund hits the
                  // correct supplier. Out-of-band Stripe dashboard
                  // refunds carry no partsportSlotId; fall back to the
                  // legacy pro-rata clawback across the order's slots.
                  const slotId = r.metadata?.partsportSlotId || "";
                  if (slotId) {
                    await applySupplierClawback(
                      { kind: "slot", slotId },
                      r.amountCents,
                      `order ${order.reference} (Stripe refund ${r.id})`
                    );
                  } else {
                    await applySupplierClawback(
                      { kind: "order", orderId: order.id },
                      r.amountCents,
                      `order ${order.reference} (Stripe refund ${r.id})`
                    );
                  }
                } catch (err) {
                  captureError(err, {
                    subsystem: "payments",
                    op: "webhook-refund-clawback",
                    stripeRefundId: r.id,
                  });
                }

                // PLH-3i P3: out-of-band Stripe-dashboard refunds also
                // sync to QBO. Mirror the admin-refund path (refundOrder
                // -> after()) for parity. Look up the Refund row we
                // just inserted by stripeRefundId. Errors swallowed at
                // the after() boundary AFTER syncRefund writes its own
                // QBO_SYNC_FAILED audit row.
                if (intuitConfigured()) {
                  const orderIdForSync = order.id;
                  const orderReferenceForSync = order.reference;
                  const stripeRefundIdForSync = r.id;
                  const amountForSync = r.amountCents;
                  const slotIdForSync = r.metadata?.partsportSlotId || "";
                  after(async () => {
                    try {
                      const refundRow = await prisma.refund.findUnique({
                        where: { stripeRefundId: stripeRefundIdForSync },
                        select: { id: true },
                      });
                      if (!refundRow) return;
                      let slotSupplierName: string | null = null;
                      if (slotIdForSync) {
                        const slot = await prisma.orderSupplierSlot.findUnique(
                          {
                            where: { id: slotIdForSync },
                            include: { supplier: { select: { name: true } } },
                          }
                        );
                        slotSupplierName = slot?.supplier?.name ?? null;
                      }
                      await syncRefund({
                        orderId: orderIdForSync,
                        refundId: refundRow.id,
                        amountCents: amountForSync,
                        slotSupplierName,
                      });
                    } catch (err) {
                      captureError(err, {
                        subsystem: "qbo-sync",
                        op: "webhook-refund-sync",
                        orderReference: orderReferenceForSync,
                        stripeRefundId: stripeRefundIdForSync,
                      });
                    }
                  });
                }
              }
            }
            // After upsert, recompute the order's refundedCents from the
            // current rows (don't trust event.amountRefundedCents because
            // a replay could undercount). Mirror to status REFUNDED at full.
            const refundSum = await prisma.refund.aggregate({
              where: { orderId: order.id, status: "succeeded" },
              _sum: { amountCents: true },
            });
            const total = refundSum._sum.amountCents || 0;
            await prisma.order.update({
              where: { id: order.id },
              data: {
                refundedCents: total,
                status:
                  total >= order.totalCents ? "REFUNDED" : order.status,
              },
            });
          }
        }
        break;
      }

      case "invoice.paid": {
        // PLH-3z-2: net-terms collection settled. Find the local invoice by
        // stripeInvoiceId, flip it PAID, record the payment, and run
        // markOrderPaid so the existing P8 payout flow + PLH-3i QBO sync +
        // order confirmation all fire (same path prepaid orders use).
        const invoice = await prisma.invoice.findUnique({
          where: { stripeInvoiceId: event.stripeInvoiceId },
          include: { order: { select: { id: true, buyerOrgId: true } } },
        });
        if (invoice && invoice.status !== "PAID") {
          // Idempotent: short-circuit on already-PAID. Stripe retries land
          // here and find status PAID, so no double PaymentRecord / payout.
          await prisma.$transaction(async (tx) => {
            await tx.invoice.update({
              where: { id: invoice.id },
              data: {
                status: "PAID",
                paidAt: new Date(),
                paidReference: event.paidReference ?? undefined,
                paymentMethod: event.paymentMethod,
                partialPaidCents: invoice.totalCents,
              },
            });
            await tx.paymentRecord.create({
              data: {
                invoiceId: invoice.id,
                amountCents: event.amountPaidCents,
                receivedAt: new Date(),
                method: event.paymentMethod,
                reference: event.paidReference ?? "",
                source: "stripe_webhook",
              },
            });
          });
          if (invoice.order) {
            await markOrderPaid(invoice.order.id, event.paymentMethod);
            // PLH-3z-4: a payment may clear a suspended org's past-due balance.
            await maybeReactivateOrg(invoice.order.buyerOrgId);
          }
          await writeAuditLog({
            actor: { id: "system", email: "system@partsport" },
            action: "INVOICE_PAID_AUTO",
            targetType: "Invoice",
            targetId: invoice.id,
            summary: `Invoice ${invoice.number} paid via Stripe (${event.paymentMethod}).`,
            metadata: {
              stripeInvoiceId: event.stripeInvoiceId,
              amountCents: event.amountPaidCents,
              paidReference: event.paidReference,
            },
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        // PLH-3z-2: leave the local invoice DUE/PAST_DUE. Audit so the A/R
        // trail shows the failed attempt. Idempotent (audit-only).
        const invoice = await prisma.invoice.findUnique({
          where: { stripeInvoiceId: event.stripeInvoiceId },
          select: { id: true, number: true },
        });
        if (invoice) {
          await writeAuditLog({
            actor: { id: "system", email: "system@partsport" },
            action: "INVOICE_PAYMENT_FAILED",
            targetType: "Invoice",
            targetId: invoice.id,
            summary: `Invoice ${invoice.number} payment failed: ${event.failureMessage}`,
            metadata: { stripeInvoiceId: event.stripeInvoiceId },
          });
        }
        break;
      }

      case "invoice.marked_uncollectible": {
        // PLH-3z-2: Stripe write-off. Flip the local invoice to UNCOLLECTIBLE
        // (idempotent) and audit.
        const invoice = await prisma.invoice.findUnique({
          where: { stripeInvoiceId: event.stripeInvoiceId },
          select: { id: true, number: true, status: true },
        });
        if (invoice && invoice.status !== "UNCOLLECTIBLE") {
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: { status: "UNCOLLECTIBLE" },
          });
          await writeAuditLog({
            actor: { id: "system", email: "system@partsport" },
            action: "INVOICE_MARKED_UNCOLLECTIBLE",
            targetType: "Invoice",
            targetId: invoice.id,
            summary: `Invoice ${invoice.number} marked uncollectible in Stripe.`,
            metadata: { stripeInvoiceId: event.stripeInvoiceId },
          });
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

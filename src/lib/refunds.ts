import "server-only";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { writeAuditLog } from "./audit";
import { captureError } from "./observability";

/**
 * Stripe refund engine. Used by /api/admin/orders/[id]/refund. Pulls the
 * stored payment_intent off the order, calls refunds.create, records the
 * Refund row, bumps Order.refundedCents, and draws from the supplier
 * reserve when the chargeback hits a Connect-active supplier.
 *
 * Returns the canonical result + the Refund row id so the caller can
 * include it in the response and the audit summary.
 */

let _client: Stripe | null = null;
function client(): Stripe | null {
  if (_client) return _client;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  _client = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-04-22.dahlia",
  });
  return _client;
}

export type RefundResult =
  | { ok: true; refundId: string; stripeRefundId: string | null }
  | { ok: false; error: string; status: number };

export async function refundOrder(args: {
  orderId: string;
  amountCents: number;
  reason: string;
  returnRequestId?: string;
  refundedByUserId: string;
  refundedByEmail: string;
}): Promise<RefundResult> {
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    include: { items: { include: { product: true } } },
  });
  if (!order) {
    return { ok: false, error: "Order not found.", status: 404 };
  }
  if (order.status !== "PAID" && order.status !== "FULFILLED") {
    return {
      ok: false,
      error: "Only paid or fulfilled orders can be refunded.",
      status: 400,
    };
  }
  const amount = Math.max(0, Math.floor(args.amountCents));
  if (amount <= 0) {
    return { ok: false, error: "Refund amount must be positive.", status: 400 };
  }
  const remaining = order.totalCents - order.refundedCents;
  if (amount > remaining) {
    return {
      ok: false,
      error: `Refund exceeds remaining ${remaining} cents on this order.`,
      status: 400,
    };
  }

  const s = client();
  let stripeRefundId: string | null = null;

  if (s && order.stripePaymentIntentId) {
    try {
      const refund = await s.refunds.create({
        payment_intent: order.stripePaymentIntentId,
        amount,
        reason: args.reason.toLowerCase().includes("fraud")
          ? "fraudulent"
          : args.reason.toLowerCase().includes("duplicate")
            ? "duplicate"
            : "requested_by_customer",
        metadata: {
          partsportOrderId: order.id,
          partsportReturnRequestId: args.returnRequestId || "",
          refundedBy: args.refundedByEmail,
        },
      });
      stripeRefundId = refund.id;
    } catch (err) {
      captureError(err, {
        subsystem: "stripe",
        op: "refund-create",
        orderId: order.id,
      });
      return {
        ok: false,
        error:
          err instanceof Error
            ? `Stripe refund failed: ${err.message}`
            : "Stripe refund failed.",
        status: 502,
      };
    }
  }
  // When Stripe is not configured OR the order was paid via the demo
  // fallback (no stored payment_intent), we still record the refund in
  // PartsPort's DB so the order math stays honest. Owner reconciles
  // manually with the gateway in that case.

  // P9.5 CRIT 5: refund clawback with shortfall netting.
  //
  // For each supplier on the order, compute their pro-rata share of the
  // refund. Draw what we can from their reserveBalanceCents. Anything
  // beyond available reserve (typical for 60-day-old orders where the
  // reserve already released to the supplier) accumulates on
  // Supplier.owedToPlatformCents and is netted against the supplier's
  // next Stripe transfer in lib/payouts.ts.
  //
  // Pre-P9.5 this comment claimed "remainder is clawed back via
  // payout-retry" - but payout-retry only retries FAILED transfers,
  // so the shortfall was silently eaten by the platform. The verify
  // chat caught this.
  const supplierShares = new Map<string, number>();
  for (const item of order.items) {
    const id = item.product.supplierId;
    supplierShares.set(
      id,
      (supplierShares.get(id) ?? 0) + item.unitPriceCents * item.qty
    );
  }
  const totalShare = Array.from(supplierShares.values()).reduce(
    (sum, n) => sum + n,
    0
  );
  if (totalShare > 0) {
    for (const [supplierId, share] of supplierShares) {
      // Proportion of this refund attributable to this supplier.
      const supplierRefundCents = Math.round((amount * share) / totalShare);
      if (supplierRefundCents <= 0) continue;
      const supplier = await prisma.supplier.findUnique({
        where: { id: supplierId },
      });
      if (!supplier) continue;
      const drawCents = Math.min(
        supplierRefundCents,
        supplier.reserveBalanceCents
      );
      const shortfallCents = supplierRefundCents - drawCents;
      const writes: Prisma.PrismaPromise<unknown>[] = [];
      if (drawCents > 0) {
        writes.push(
          prisma.supplier.update({
            where: { id: supplierId },
            data: { reserveBalanceCents: { decrement: drawCents } },
          })
        );
        writes.push(
          prisma.supplierReserveTransaction.create({
            data: {
              supplierId,
              type: "DRAW_DOWN",
              amountCents: drawCents,
              orderId: order.id,
              reason: `Refund of ${amount} cents on order ${order.reference}`,
            },
          })
        );
      }
      if (shortfallCents > 0) {
        // Net against future payouts. Records as an OWE transaction so
        // /admin/audit + the reserve transaction view show the running
        // balance the supplier owes back to PartsPort.
        writes.push(
          prisma.supplier.update({
            where: { id: supplierId },
            data: { owedToPlatformCents: { increment: shortfallCents } },
          })
        );
        writes.push(
          prisma.supplierReserveTransaction.create({
            data: {
              supplierId,
              type: "DRAW_DOWN",
              amountCents: shortfallCents,
              orderId: order.id,
              reason: `Refund shortfall on order ${order.reference}: insufficient reserve, owed against future payouts`,
            },
          })
        );
      }
      if (writes.length > 0) {
        await prisma.$transaction(writes);
      }
    }
  }

  // Record the Refund row and update Order totals atomically.
  const refund = await prisma.$transaction(async (tx) => {
    const r = await tx.refund.create({
      data: {
        orderId: order.id,
        stripeRefundId,
        amountCents: amount,
        reason: args.reason.slice(0, 500),
        returnRequestId: args.returnRequestId || null,
        refundedBy: args.refundedByUserId,
        status: "succeeded",
      },
    });
    const newRefundedCents = order.refundedCents + amount;
    const isFullRefund = newRefundedCents >= order.totalCents;
    await tx.order.update({
      where: { id: order.id },
      data: {
        refundedCents: newRefundedCents,
        ...(isFullRefund ? { status: "REFUNDED" } : {}),
      },
    });
    return r;
  });

  await writeAuditLog({
    actor: { id: args.refundedByUserId, email: args.refundedByEmail },
    action: "ORDER_REFUNDED",
    targetType: "Order",
    targetId: order.id,
    summary: `Refunded ${amount} cents on order ${order.reference} (${args.reason})`,
    metadata: {
      orderReference: order.reference,
      amountCents: amount,
      stripeRefundId,
      returnRequestId: args.returnRequestId,
    },
  });

  return { ok: true, refundId: refund.id, stripeRefundId };
}

import "server-only";
import Stripe from "stripe";
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

/**
 * PLH-1 commit 5: per-supplier refund clawback. Computes each supplier's
 * pro-rata share of the refund (by line subtotal), draws what's available
 * from their reserveBalanceCents, and accumulates any shortfall on
 * Supplier.owedToPlatformCents (netted against the next Stripe transfer
 * in lib/payouts.ts).
 *
 * Wrapped in $transaction with fresh re-reads INSIDE the tx so a
 * concurrent payout-success owed-recovery can't push the values past the
 * supplier_*_nonneg CHECK constraints (P12 H8 atomicity guarantee).
 *
 * Called from:
 *   - refundOrder() in this file (admin-initiated refund path)
 *   - charge.refunded webhook handler (out-of-band Stripe refund path)
 *
 * Pre-PLH-1 the webhook path only upserted the Refund row + bumped
 * Order.refundedCents, so reserve/owed never moved for refunds that
 * originated in the Stripe dashboard. This function closes that gap.
 */
export async function applySupplierClawback(
  orderId: string,
  refundAmountCents: number,
  refundRef: string,
  audit?: { actorId: string; actorEmail: string }
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } } },
  });
  if (!order) return;
  const amount = Math.max(0, Math.floor(refundAmountCents));
  if (amount <= 0) return;

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
  if (totalShare <= 0) return;

  for (const [supplierId, share] of supplierShares) {
    const supplierRefundCents = Math.round((amount * share) / totalShare);
    if (supplierRefundCents <= 0) continue;
    const { supplierName, drawCents, shortfallCents } =
      await prisma.$transaction(async (tx) => {
        const supplier = await tx.supplier.findUnique({
          where: { id: supplierId },
        });
        if (!supplier) {
          return { supplierName: "", drawCents: 0, shortfallCents: 0 };
        }
        const fresh = Math.max(0, supplier.reserveBalanceCents);
        const drawC = Math.min(supplierRefundCents, fresh);
        const shortC = supplierRefundCents - drawC;
        if (drawC > 0) {
          await tx.supplier.update({
            where: { id: supplierId },
            data: { reserveBalanceCents: { decrement: drawC } },
          });
          await tx.supplierReserveTransaction.create({
            data: {
              supplierId,
              type: "DRAW_DOWN",
              amountCents: drawC,
              orderId: order.id,
              reason: `Refund of ${amount} cents on ${refundRef}`,
            },
          });
        }
        if (shortC > 0) {
          await tx.supplier.update({
            where: { id: supplierId },
            data: { owedToPlatformCents: { increment: shortC } },
          });
          await tx.supplierReserveTransaction.create({
            data: {
              supplierId,
              type: "OWED_INCURRED",
              amountCents: shortC,
              orderId: order.id,
              reason: `Owed to platform: ${shortC} cents shortfall on refund for ${refundRef}`,
            },
          });
        }
        return {
          supplierName: supplier.name,
          drawCents: drawC,
          shortfallCents: shortC,
        };
      });
    void drawCents;
    if (shortfallCents > 0) {
      const updated = await prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { owedToPlatformCents: true },
      });
      await writeAuditLog({
        actor: audit
          ? { id: audit.actorId, email: audit.actorEmail }
          : { id: "system", email: "system@partsport" },
        action: "OWED_INCURRED",
        targetType: "Supplier",
        targetId: supplierId,
        summary: `Supplier ${supplierName} owes ${shortfallCents} more cents to platform (refund shortfall on ${refundRef})`,
        metadata: {
          supplierId,
          supplierName,
          orderId: order.id,
          orderReference: order.reference,
          amountCents: shortfallCents,
          owedBalanceCents: updated?.owedToPlatformCents ?? 0,
          cause: "REFUND_SHORTFALL",
        },
      });
    }
  }
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
  /**
   * P9.5 HIGH 12: when true, allow a DB-only refund for orders that
   * weren't paid via Stripe (demo / PayPal). Without this flag, the
   * route refuses to record a refund whose money path isn't traceable.
   * The admin UI exposes this as a separate "Mark as refunded manually"
   * action so the path is intentional, not silent.
   */
  manualOverride?: boolean;
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

  // P9.5 HIGH 12: gate DB-only refunds. Stripe IS configured but this
  // order has no stripePaymentIntentId (demo checkout, PayPal, or a
  // pre-P8 order that didn't capture the PI). Without manualOverride
  // the route refuses, so admin has to intentionally pick the manual
  // path. Pre-fix the route silently recorded a "succeeded" refund in
  // the DB even though no money moved, leaving the buyer charged.
  if (s && !order.stripePaymentIntentId && !args.manualOverride) {
    return {
      ok: false,
      error:
        "This order has no Stripe payment_intent on file. Either find the original Stripe charge and refund it manually via the Stripe dashboard, or call the refund API again with manualOverride: true to record a DB-only refund.",
      status: 400,
    };
  }

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
      // P9.5 HIGH 13: write a failed-refund audit row so the admin trail
      // shows the attempt and the error, not just successful refunds.
      await writeAuditLog({
        actor: { id: args.refundedByUserId, email: args.refundedByEmail },
        action: "ORDER_REFUND_FAILED",
        targetType: "Order",
        targetId: order.id,
        summary: `Stripe refund FAILED on order ${order.reference} (${amount} cents): ${err instanceof Error ? err.message : "unknown error"}`,
        metadata: {
          orderReference: order.reference,
          amountCents: amount,
          paymentIntent: order.stripePaymentIntentId,
        },
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

  // P9.5 CRIT 5 / PLH-1 commit 5: refund clawback with shortfall netting.
  // Extracted into applySupplierClawback so the charge.refunded webhook
  // can call the same primitive when an out-of-band Stripe refund lands.
  await applySupplierClawback(
    order.id,
    amount,
    `order ${order.reference}`,
    {
      actorId: args.refundedByUserId,
      actorEmail: args.refundedByEmail,
    }
  );

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

import "server-only";
import { after } from "next/server";
import Stripe from "stripe";
import { prisma } from "./db";
import { writeAuditLog } from "./audit";
import { captureError } from "./observability";
import { intuitConfigured } from "./qbo-auth";
import { syncRefund } from "./qbo-sync";

/**
 * Stripe refund engine. Used by /api/admin/orders/[id]/refund. Pulls the
 * stored payment_intent off the order, calls refunds.create, records the
 * Refund row, bumps Order.refundedCents, and draws from the supplier
 * reserve when the chargeback hits a Connect-active supplier.
 *
 * PLH-3g P6: refunds now route per-slot. An order can have N
 * OrderSupplierSlot rows (one per participating supplier). A refund can
 * be scoped to:
 *   - a single OrderItem (auto-derives amount + targets that item's slot)
 *   - a single slot (clawback that one supplier)
 *   - the whole order (pro-rata across slots, legacy behavior)
 *
 * The Stripe refund metadata carries the scope so the charge.refunded
 * webhook can route an out-of-band refund to the right slot. Legacy
 * refunds without slot metadata fall back to pro-rata clawback.
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
 * Internal primitive. Clawback a single slot for a specific cents amount.
 *
 *   - Draws from Supplier.reserveBalanceCents (DRAW_DOWN).
 *   - Any shortfall lands on Supplier.owedToPlatformCents (OWED_INCURRED).
 *   - Bumps OrderSupplierSlot.refundedCents by the requested amount so
 *     the slot's per-supplier accounting stays consistent.
 *
 * Wrapped in $transaction with fresh re-reads INSIDE the tx so a
 * concurrent payout-success owed-recovery can't push the values past
 * the supplier_*_nonneg CHECK constraints (P12 H8 atomicity guarantee).
 */
async function clawbackSlot(
  slotId: string,
  refundAmountCents: number,
  refundRef: string,
  audit?: { actorId: string; actorEmail: string }
): Promise<void> {
  const amount = Math.max(0, Math.floor(refundAmountCents));
  if (amount <= 0) return;

  const slot = await prisma.orderSupplierSlot.findUnique({
    where: { id: slotId },
    include: { order: true, supplier: true },
  });
  if (!slot) return;

  const { supplierName, shortfallCents } = await prisma.$transaction(
    async (tx) => {
      // Re-read fresh inside the tx so a racing payout-success can't push
      // reserve below 0 vs the CHECK constraint.
      const supplier = await tx.supplier.findUnique({
        where: { id: slot.supplierId },
      });
      if (!supplier) {
        return { supplierName: "", shortfallCents: 0 };
      }
      const fresh = Math.max(0, supplier.reserveBalanceCents);
      const drawC = Math.min(amount, fresh);
      const shortC = amount - drawC;
      if (drawC > 0) {
        await tx.supplier.update({
          where: { id: slot.supplierId },
          data: { reserveBalanceCents: { decrement: drawC } },
        });
        await tx.supplierReserveTransaction.create({
          data: {
            supplierId: slot.supplierId,
            type: "DRAW_DOWN",
            amountCents: drawC,
            orderId: slot.orderId,
            reason: `Refund of ${amount} cents on ${refundRef}`,
          },
        });
      }
      if (shortC > 0) {
        await tx.supplier.update({
          where: { id: slot.supplierId },
          data: { owedToPlatformCents: { increment: shortC } },
        });
        await tx.supplierReserveTransaction.create({
          data: {
            supplierId: slot.supplierId,
            type: "OWED_INCURRED",
            amountCents: shortC,
            orderId: slot.orderId,
            reason: `Owed to platform: ${shortC} cents shortfall on refund for ${refundRef}`,
          },
        });
      }
      // Bump slot refundedCents so per-slot accounting reflects the
      // claw. Slot caps are enforced upstream in refundOrder (validate
      // amount <= slot.subtotal+freight - slot.refundedCents).
      await tx.orderSupplierSlot.update({
        where: { id: slot.id },
        data: { refundedCents: { increment: amount } },
      });
      return {
        supplierName: supplier.name,
        shortfallCents: shortC,
      };
    }
  );

  if (shortfallCents > 0) {
    const updated = await prisma.supplier.findUnique({
      where: { id: slot.supplierId },
      select: { owedToPlatformCents: true },
    });
    await writeAuditLog({
      actor: audit
        ? { id: audit.actorId, email: audit.actorEmail }
        : { id: "system", email: "system@partsport" },
      action: "OWED_INCURRED",
      targetType: "Supplier",
      targetId: slot.supplierId,
      summary: `Supplier ${supplierName} owes ${shortfallCents} more cents to platform (refund shortfall on ${refundRef})`,
      metadata: {
        supplierId: slot.supplierId,
        supplierName,
        orderId: slot.orderId,
        orderReference: slot.order.reference,
        slotId: slot.id,
        amountCents: shortfallCents,
        owedBalanceCents: updated?.owedToPlatformCents ?? 0,
        cause: "REFUND_SHORTFALL",
      },
    });
  }
}

/**
 * Public clawback primitive used by the charge.refunded webhook.
 *
 * PLH-3g P6: when the Stripe refund metadata carries a slotId, pass it
 * here and the clawback hits only that supplier. When slotId is absent
 * (legacy refunds, out-of-band Stripe dashboard refunds with no
 * partsport metadata, refunds created before P6 shipped), fall through
 * to the pro-rata branch which distributes across all slots on the
 * order by (subtotal + freight). Either way the math nets to the same
 * total amount drawn / owed.
 */
export async function applySupplierClawback(
  arg:
    | { kind: "slot"; slotId: string }
    | { kind: "order"; orderId: string }
    | string,
  refundAmountCents: number,
  refundRef: string,
  audit?: { actorId: string; actorEmail: string }
): Promise<void> {
  const amount = Math.max(0, Math.floor(refundAmountCents));
  if (amount <= 0) return;

  // Back-compat: an old caller passing the orderId string directly is
  // treated as the legacy pro-rata branch. New callers pass the
  // discriminated object.
  const target =
    typeof arg === "string" ? { kind: "order" as const, orderId: arg } : arg;

  if (target.kind === "slot") {
    await clawbackSlot(target.slotId, amount, refundRef, audit);
    return;
  }

  // kind === "order": legacy pro-rata. Prefer slots when they exist
  // (every order created after PLH-3g P3 has at least one slot, and
  // P1's backfill migration ensured every pre-existing order does too).
  // Fall back to the item-supplier-share path only if no slots exist
  // (defensive; should not happen post-P1).
  const slots = await prisma.orderSupplierSlot.findMany({
    where: { orderId: target.orderId },
  });
  if (slots.length > 0) {
    const totalBase = slots.reduce(
      (sum, s) => sum + s.subtotalCents + s.freightCents,
      0
    );
    if (totalBase <= 0) return;
    let distributed = 0;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const isLast = i === slots.length - 1;
      const share = isLast
        ? amount - distributed
        : Math.round((amount * (s.subtotalCents + s.freightCents)) / totalBase);
      if (share > 0) {
        await clawbackSlot(s.id, share, refundRef, audit);
        distributed += share;
      }
    }
    return;
  }

  // Pre-P1 / no-slots safety net (should be unreachable on production
  // data given the P1 backfill, retained so any orphan order doesn't
  // bypass clawback entirely).
  const order = await prisma.order.findUnique({
    where: { id: target.orderId },
    include: { items: { include: { product: true } } },
  });
  if (!order) return;
  const shares = new Map<string, number>();
  for (const item of order.items) {
    const id = item.product.supplierId;
    shares.set(id, (shares.get(id) ?? 0) + item.unitPriceCents * item.qty);
  }
  const totalShare = Array.from(shares.values()).reduce((a, b) => a + b, 0);
  if (totalShare <= 0) return;
  for (const [supplierId, share] of shares) {
    const supplierRefundCents = Math.round((amount * share) / totalShare);
    if (supplierRefundCents <= 0) continue;
    // No slot row exists, so run the inline clawback against the
    // supplier directly (mirrors the old behavior, sans slot update).
    const { supplierName, shortfallCents } = await prisma.$transaction(
      async (tx) => {
        const supplier = await tx.supplier.findUnique({
          where: { id: supplierId },
        });
        if (!supplier) {
          return { supplierName: "", shortfallCents: 0 };
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
        return { supplierName: supplier.name, shortfallCents: shortC };
      }
    );
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

export type RefundScope =
  | { kind: "order" }
  | { kind: "slot"; slotId: string }
  | { kind: "item"; orderItemId: string };

export type RefundResult =
  | {
      ok: true;
      refundId: string;
      stripeRefundId: string | null;
      amountCents: number;
      // PLH-3g P7: when the refund was scoped to a slot or item, surface
      // the affected supplier name so the buyer email can say "Supplier
      // X's portion refunded" rather than the generic "order refunded".
      slotSupplierName?: string | null;
    }
  | { ok: false; error: string; status: number };

export async function refundOrder(args: {
  orderId: string;
  /**
   * Optional. When omitted on a scoped refund (item / slot), the amount
   * auto-derives from the scope target (item: qty * unitPrice; slot:
   * subtotal + freight - already refunded). When scope is "order" the
   * amount is required.
   */
  amountCents?: number;
  reason: string;
  returnRequestId?: string;
  refundedByUserId: string;
  refundedByEmail: string;
  /**
   * PLH-3g P6: per-supplier refund routing. Default = whole-order
   * refund (legacy pro-rata). Item / slot scopes route the clawback
   * to one supplier and tag the Stripe refund metadata so the
   * charge.refunded webhook follows the same path.
   */
  scope?: RefundScope;
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
    include: {
      items: { include: { product: true } },
      supplierSlots: { include: { supplier: { select: { name: true } } } },
    },
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

  const scope: RefundScope = args.scope ?? { kind: "order" };

  // Resolve amount + target slot per scope.
  let amount = Math.max(0, Math.floor(args.amountCents ?? 0));
  let targetSlotId: string | null = null;
  let targetOrderItemId: string | null = null;

  if (scope.kind === "item") {
    const item = order.items.find((i) => i.id === scope.orderItemId);
    if (!item) {
      return { ok: false, error: "Order item not found.", status: 404 };
    }
    const slot = order.supplierSlots.find(
      (s) => s.supplierId === item.product.supplierId
    );
    if (!slot) {
      return {
        ok: false,
        error: "No supplier slot for this item (legacy order without slots).",
        status: 400,
      };
    }
    const itemLineCents = item.unitPriceCents * item.qty;
    if (amount <= 0) amount = itemLineCents;
    if (amount > itemLineCents) {
      return {
        ok: false,
        error: `Refund exceeds item line total ${itemLineCents} cents.`,
        status: 400,
      };
    }
    const slotRemaining =
      slot.subtotalCents + slot.freightCents - slot.refundedCents;
    if (amount > slotRemaining) {
      return {
        ok: false,
        error: `Refund exceeds remaining ${slotRemaining} cents on the supplier slot.`,
        status: 400,
      };
    }
    targetSlotId = slot.id;
    targetOrderItemId = item.id;
  } else if (scope.kind === "slot") {
    const slot = order.supplierSlots.find((s) => s.id === scope.slotId);
    if (!slot) {
      return { ok: false, error: "Supplier slot not found.", status: 404 };
    }
    const slotRemaining =
      slot.subtotalCents + slot.freightCents - slot.refundedCents;
    if (amount <= 0) amount = slotRemaining;
    if (amount > slotRemaining) {
      return {
        ok: false,
        error: `Refund exceeds remaining ${slotRemaining} cents on the supplier slot.`,
        status: 400,
      };
    }
    targetSlotId = slot.id;
  } else {
    // order scope: amount required.
    if (amount <= 0) {
      return {
        ok: false,
        error: "Refund amount must be positive.",
        status: 400,
      };
    }
  }

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

  // P9.5 HIGH 12: gate DB-only refunds (see comment at top of refundOrder).
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
          // PLH-3g P6: route the webhook clawback to the right slot.
          // The webhook reads slotId out of metadata when present.
          partsportScope: scope.kind,
          partsportSlotId: targetSlotId || "",
          partsportOrderItemId: targetOrderItemId || "",
        },
      });
      stripeRefundId = refund.id;
    } catch (err) {
      captureError(err, {
        subsystem: "stripe",
        op: "refund-create",
        orderId: order.id,
      });
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
          scope: scope.kind,
          slotId: targetSlotId,
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

  // P9.5 CRIT 5 / PLH-1 commit 5 / PLH-3g P6: per-supplier clawback.
  // Scoped refunds hit one slot; order-scoped refunds split pro-rata.
  if (targetSlotId) {
    await applySupplierClawback(
      { kind: "slot", slotId: targetSlotId },
      amount,
      `order ${order.reference}`,
      {
        actorId: args.refundedByUserId,
        actorEmail: args.refundedByEmail,
      }
    );
  } else {
    await applySupplierClawback(
      { kind: "order", orderId: order.id },
      amount,
      `order ${order.reference}`,
      {
        actorId: args.refundedByUserId,
        actorEmail: args.refundedByEmail,
      }
    );
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
      scope: scope.kind,
      slotId: targetSlotId,
      orderItemId: targetOrderItemId,
    },
  });

  // PLH-3g P7: surface affected supplier name for scoped refunds so the
  // outbound buyer email can name them.
  let slotSupplierName: string | null = null;
  if (targetSlotId) {
    const slot = order.supplierSlots.find((sl) => sl.id === targetSlotId);
    slotSupplierName = slot?.supplier?.name ?? null;
  }

  // PLH-3i P3: push a RefundReceipt to QuickBooks Online. Mirrors the
  // markOrderPaid invoice-sync pattern: gated on intuitConfigured(),
  // fired via after() so the caller's response isn't blocked on the
  // Intuit round-trip, and errors swallowed at the after() boundary
  // AFTER syncRefund writes its own QBO_SYNC_FAILED audit row +
  // captureError. A QBO outage cannot break the admin refund flow.
  if (intuitConfigured()) {
    const refundIdForSync = refund.id;
    const amountForSync = amount;
    const slotSupplierNameForSync = slotSupplierName;
    after(async () => {
      try {
        await syncRefund({
          orderId: order.id,
          refundId: refundIdForSync,
          amountCents: amountForSync,
          slotSupplierName: slotSupplierNameForSync,
        });
      } catch {
        // already audited + captured inside syncRefund
      }
    });
  }

  return {
    ok: true,
    refundId: refund.id,
    stripeRefundId,
    amountCents: amount,
    slotSupplierName,
  };
}

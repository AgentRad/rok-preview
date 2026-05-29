import "server-only";
import { after } from "next/server";
import Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { writeAuditLog } from "./audit";
import { refundRemainingCents } from "./route-guards";
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
 * QA2 BUG 2. An OWED_INCURRED audit entry produced by a clawback, deferred
 * so the audit-log write happens AFTER the money-move transaction commits
 * (writeAuditLog is its own DB write; keeping it out of the unified refund
 * tx keeps that tx short and avoids holding it open across audit writes).
 */
type PendingOwedAudit = {
  supplierId: string;
  supplierName: string;
  orderId: string;
  orderReference: string;
  slotId: string | null;
  shortfallCents: number;
  owedBalanceCents: number;
};

async function writeOwedAudits(
  audits: PendingOwedAudit[],
  refundRef: string,
  audit?: { actorId: string; actorEmail: string }
): Promise<void> {
  for (const a of audits) {
    await writeAuditLog({
      actor: audit
        ? { id: audit.actorId, email: audit.actorEmail }
        : { id: "system", email: "system@partsport" },
      action: "OWED_INCURRED",
      targetType: "Supplier",
      targetId: a.supplierId,
      summary: `Supplier ${a.supplierName} owes ${a.shortfallCents} more cents to platform (refund shortfall on ${refundRef})`,
      metadata: {
        supplierId: a.supplierId,
        supplierName: a.supplierName,
        orderId: a.orderId,
        orderReference: a.orderReference,
        slotId: a.slotId,
        amountCents: a.shortfallCents,
        owedBalanceCents: a.owedBalanceCents,
        cause: "REFUND_SHORTFALL",
      },
    });
  }
}

/**
 * Internal in-tx primitive. Clawback a single slot for a specific cents
 * amount on the CALLER's transaction client so it can be folded into a
 * larger atomic unit (the QA2 BUG 2 unified refund tx, or the standalone
 * webhook tx below).
 *
 *   - Draws from Supplier.reserveBalanceCents (DRAW_DOWN).
 *   - Any shortfall lands on Supplier.owedToPlatformCents (OWED_INCURRED).
 *   - Bumps OrderSupplierSlot.refundedCents so per-supplier accounting stays
 *     consistent.
 *
 * Fresh re-read of the supplier reserve INSIDE the tx (Math.min) so a racing
 * payout-success owed-recovery can't push the values past the
 * supplier_*_nonneg CHECK constraints (P12 H8 atomicity guarantee). Returns
 * a PendingOwedAudit when a shortfall was incurred, else null; the caller
 * writes the audit AFTER the tx commits.
 */
async function clawbackSlotInTx(
  tx: Prisma.TransactionClient,
  slotId: string,
  refundAmountCents: number,
  refundRef: string
): Promise<PendingOwedAudit | null> {
  const amount = Math.max(0, Math.floor(refundAmountCents));
  if (amount <= 0) return null;

  const slot = await tx.orderSupplierSlot.findUnique({
    where: { id: slotId },
    include: { order: true, supplier: true },
  });
  if (!slot) return null;

  const supplier = await tx.supplier.findUnique({
    where: { id: slot.supplierId },
  });
  if (!supplier) return null;

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
  // Bump slot refundedCents so per-slot accounting reflects the claw. Slot
  // caps are enforced upstream in refundOrder (validate amount <=
  // slot.subtotal+freight - slot.refundedCents).
  await tx.orderSupplierSlot.update({
    where: { id: slot.id },
    data: { refundedCents: { increment: amount } },
  });

  if (shortC > 0) {
    return {
      supplierId: slot.supplierId,
      supplierName: supplier.name,
      orderId: slot.orderId,
      orderReference: slot.order.reference,
      slotId: slot.id,
      shortfallCents: shortC,
      owedBalanceCents: supplier.owedToPlatformCents + shortC,
    };
  }
  return null;
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
/**
 * In-tx distributor. Runs the whole clawback (slot-scoped or order-scoped
 * pro-rata) on the CALLER's transaction client and RETURNS the deferred
 * OWED_INCURRED audits. Both the standalone webhook entry point and the QA2
 * BUG 2 unified refund tx share this single implementation, so the netting
 * (Math.min + fresh reserve re-read, owedToPlatformCents shortfall) lives in
 * exactly one place.
 */
async function applySupplierClawbackInTx(
  tx: Prisma.TransactionClient,
  arg:
    | { kind: "slot"; slotId: string }
    | { kind: "order"; orderId: string }
    | string,
  refundAmountCents: number,
  refundRef: string
): Promise<PendingOwedAudit[]> {
  const amount = Math.max(0, Math.floor(refundAmountCents));
  if (amount <= 0) return [];

  const target =
    typeof arg === "string" ? { kind: "order" as const, orderId: arg } : arg;
  const audits: PendingOwedAudit[] = [];

  if (target.kind === "slot") {
    const a = await clawbackSlotInTx(tx, target.slotId, amount, refundRef);
    if (a) audits.push(a);
    return audits;
  }

  // kind === "order": pro-rata. Prefer slots when they exist (every order
  // created after PLH-3g P3 has at least one slot, and P1's backfill ensured
  // every pre-existing order does too).
  const slots = await tx.orderSupplierSlot.findMany({
    where: { orderId: target.orderId },
  });
  if (slots.length > 0) {
    const totalBase = slots.reduce(
      (sum, s) => sum + s.subtotalCents + s.freightCents,
      0
    );
    if (totalBase <= 0) return audits;
    let distributed = 0;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const isLast = i === slots.length - 1;
      const share = isLast
        ? amount - distributed
        : Math.round((amount * (s.subtotalCents + s.freightCents)) / totalBase);
      if (share > 0) {
        const a = await clawbackSlotInTx(tx, s.id, share, refundRef);
        if (a) audits.push(a);
        distributed += share;
      }
    }
    return audits;
  }

  // Pre-P1 / no-slots safety net (should be unreachable on production data
  // given the P1 backfill, retained so any orphan order doesn't bypass
  // clawback entirely). Runs the inline clawback against the supplier
  // directly (mirrors the old behavior, sans slot update).
  const order = await tx.order.findUnique({
    where: { id: target.orderId },
    include: { items: { include: { product: true } } },
  });
  if (!order) return audits;
  const shares = new Map<string, number>();
  for (const item of order.items) {
    const id = item.product.supplierId;
    shares.set(id, (shares.get(id) ?? 0) + item.unitPriceCents * item.qty);
  }
  const totalShare = Array.from(shares.values()).reduce((a, b) => a + b, 0);
  if (totalShare <= 0) return audits;
  for (const [supplierId, share] of shares) {
    const supplierRefundCents = Math.round((amount * share) / totalShare);
    if (supplierRefundCents <= 0) continue;
    const supplier = await tx.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) continue;
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
      audits.push({
        supplierId,
        supplierName: supplier.name,
        orderId: order.id,
        orderReference: order.reference,
        slotId: null,
        shortfallCents: shortC,
        owedBalanceCents: supplier.owedToPlatformCents + shortC,
      });
    }
  }
  return audits;
}

/**
 * Public clawback primitive used by the charge.refunded webhook.
 *
 * PLH-3g P6: when the Stripe refund metadata carries a slotId, pass it here
 * and the clawback hits only that supplier. When slotId is absent (legacy
 * refunds, out-of-band Stripe dashboard refunds with no partsport metadata,
 * refunds created before P6 shipped), fall through to the pro-rata branch
 * which distributes across all slots on the order by (subtotal + freight).
 * Either way the math nets to the same total amount drawn / owed.
 *
 * QA2 BUG 2: the whole clawback now runs in ONE $transaction (previously
 * one tx per slot); the deferred OWED_INCURRED audits are written after it
 * commits. The fresh-reserve re-read + Math.min netting is unchanged.
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
  const audits = await prisma.$transaction((tx) =>
    applySupplierClawbackInTx(tx, arg, amount, refundRef)
  );
  await writeOwedAudits(audits, refundRef, audit);
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
  // Preliminary over-refund cap (fast reject before any Stripe call). This
  // reads the order snapshot from the top of the function and is NOT the race
  // guard: the authoritative cap is re-read FRESH inside the unified tx below
  // (QA2 BUG 2). Stripe's charge-level cap backstops the Stripe path; the
  // in-tx re-read is what protects manualOverride DB-only refunds.
  const remaining = refundRemainingCents(order.totalCents, order.refundedCents);
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

  // QA2 BUG 2 (concurrency cap + atomicity). The over-refund cap re-read, the
  // per-supplier clawback (P9.5 CRIT 5 / PLH-1 commit 5 / PLH-3g P6), the
  // Refund row, and the Order.refundedCents bump now run in ONE transaction
  // with a FRESH in-tx read of refundedCents. Previously the clawback and the
  // refundedCents bump were separate transactions and the cap read the stale
  // top-of-function snapshot, so two concurrent manualOverride DB-only refunds
  // (no Stripe charge-cap backstop) could both pass the cap, each clawback the
  // reserve, and push refundedCents past totalCents; a crash between the two
  // txns left the reserve drawn with no Refund row. The Stripe refund already
  // fired ABOVE, outside this tx (never hold a DB tx open across a network
  // call); the in-tx cap re-read is the race fix for BOTH paths. Clamping the
  // amount via {increment} keeps refundedCents and the reserve consistent.
  const clawTarget = targetSlotId
    ? ({ kind: "slot", slotId: targetSlotId } as const)
    : ({ kind: "order", orderId: order.id } as const);

  const txOut = await prisma.$transaction(async (tx) => {
    const fresh = await tx.order.findUnique({
      where: { id: order.id },
      select: { refundedCents: true, totalCents: true },
    });
    if (!fresh) {
      return { kind: "notfound" as const };
    }
    const freshRemaining = refundRemainingCents(
      fresh.totalCents,
      fresh.refundedCents
    );
    if (amount > freshRemaining) {
      // Over the cap as of the fresh in-tx read: reject, having written
      // nothing. (For the Stripe path this is essentially unreachable since
      // a concurrent over-refund is rejected at Stripe's charge cap before
      // reaching here; for the manualOverride DB-only path this is the guard.)
      return { kind: "over" as const, remaining: freshRemaining };
    }

    const owedAudits = await applySupplierClawbackInTx(
      tx,
      clawTarget,
      amount,
      `order ${order.reference}`
    );

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

    const isFullRefund = fresh.refundedCents + amount >= fresh.totalCents;
    await tx.order.update({
      where: { id: order.id },
      data: {
        refundedCents: { increment: amount },
        ...(isFullRefund ? { status: "REFUNDED" } : {}),
      },
    });

    return { kind: "ok" as const, refundId: r.id, owedAudits };
  });

  if (txOut.kind === "notfound") {
    return { ok: false, error: "Order not found.", status: 404 };
  }
  if (txOut.kind === "over") {
    return {
      ok: false,
      error: `Refund exceeds remaining ${txOut.remaining} cents on this order.`,
      status: 400,
    };
  }

  // Money moved; write the deferred OWED_INCURRED shortfall audits now that
  // the unified tx has committed.
  await writeOwedAudits(txOut.owedAudits, `order ${order.reference}`, {
    actorId: args.refundedByUserId,
    actorEmail: args.refundedByEmail,
  });
  const refund = { id: txOut.refundId };

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

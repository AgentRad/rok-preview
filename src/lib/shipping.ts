import "server-only";
import { after } from "next/server";
import { prisma } from "./db";
import { sendOrderShipped, sendOrderDelivered } from "./email";
import { ensurePayoutsForOrder } from "./payouts";
import { writeAuditLog } from "./audit";
import { captureError } from "./observability";

/**
 * PLH-3g Phase 5: per-supplier shipment dispatch.
 *
 * Before P5 a single Order had one carrier + trackingCode + shipmentStage.
 * The Order.shipmentStage flipped Pending -> Processing -> Shipped ->
 * Delivered in one shot via markOrderShipped(orderId). That worked while
 * carts were single-supplier-only.
 *
 * After P5 each OrderSupplierSlot carries its own carrier / trackingCode /
 * trackingUrl / shipmentStage / shippedAt / deliveredAt. The parent
 * Order.shipmentStage becomes the AGGREGATE state recomputed on every
 * slot transition:
 *
 *   - all slots Delivered                -> Order.shipmentStage = "Delivered"
 *   - all slots Shipped or Delivered     -> Order.shipmentStage = "Shipped"
 *   - any slot Shipped/Delivered (mixed) -> Order.shipmentStage = "Partial: N of M shipped"
 *   - none Shipped or Delivered          -> Order.shipmentStage = "Pending"
 *
 * Order.shippedAt: stamped at the FIRST slot's ship transition (idempotent;
 * once set, never overwritten). This is the timestamp the buyer's UI shows
 * as "first movement on this order" and the supplier-health metric reads
 * per-slot directly so this Order-level field is just a buyer-facing UX
 * hint, not a per-supplier metric.
 *
 * Order.deliveredAt: stamped only when ALL slots are Delivered, since the
 * 30-day return window (PLH-3c F5) opens once the buyer has received the
 * entire order.
 */

export type MarkShippedResult = {
  ok: true;
  alreadyShipped?: boolean;
};

export type MarkShippedError = {
  ok: false;
  status: number;
  error: string;
};

type RecomputeStage =
  | "Pending"
  | "Shipped"
  | "Delivered"
  | `Partial: ${number} of ${number} shipped`;

function computeAggregate(
  slots: { shipmentStage: string }[]
): { stage: RecomputeStage; allDelivered: boolean; allShippedOrDelivered: boolean } {
  const total = slots.length;
  let shippedOrDelivered = 0;
  let delivered = 0;
  for (const s of slots) {
    if (s.shipmentStage === "Delivered") {
      delivered++;
      shippedOrDelivered++;
    } else if (s.shipmentStage === "Shipped") {
      shippedOrDelivered++;
    }
  }
  if (total > 0 && delivered === total) {
    return { stage: "Delivered", allDelivered: true, allShippedOrDelivered: true };
  }
  if (total > 0 && shippedOrDelivered === total) {
    return { stage: "Shipped", allDelivered: false, allShippedOrDelivered: true };
  }
  if (shippedOrDelivered > 0) {
    return {
      stage: `Partial: ${shippedOrDelivered} of ${total} shipped` as RecomputeStage,
      allDelivered: false,
      allShippedOrDelivered: false,
    };
  }
  return { stage: "Pending", allDelivered: false, allShippedOrDelivered: false };
}

/**
 * Per-supplier ship dispatch. Idempotent: a slot already in Shipped or
 * Delivered state returns { alreadyShipped: true } without rewriting.
 * Runs inside a $transaction so the slot update + aggregate Order
 * recompute land atomically.
 */
export async function markSlotShipped(
  slotId: string,
  opts: { carrier: string; trackingCode: string; trackingUrl?: string | null }
): Promise<MarkShippedResult | MarkShippedError> {
  const carrierClean = opts.carrier.trim();
  const trackingClean = opts.trackingCode.trim();
  const trackingUrlClean = (opts.trackingUrl ?? "").trim() || null;
  if (!carrierClean || !trackingClean) {
    return {
      ok: false,
      status: 400,
      error: "Carrier and tracking code are required to mark shipped.",
    };
  }

  const slot = await prisma.orderSupplierSlot.findUnique({
    where: { id: slotId },
    include: { order: true },
  });
  if (!slot) {
    return { ok: false, status: 404, error: "Shipment slot not found." };
  }
  const order = slot.order;
  if (order.status !== "PAID" && order.status !== "FULFILLED") {
    return {
      ok: false,
      status: 400,
      error: "Only paid orders can be marked shipped.",
    };
  }
  if (slot.shipmentStage === "Shipped" || slot.shipmentStage === "Delivered") {
    return { ok: true, alreadyShipped: true };
  }

  const orderId = order.id;
  const supplierId = slot.supplierId;

  const { allDelivered } = await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.orderSupplierSlot.update({
      where: { id: slotId },
      data: {
        shipmentStage: "Shipped",
        carrier: carrierClean,
        trackingCode: trackingClean,
        trackingUrl: trackingUrlClean,
        shippedAt: now,
      },
    });
    const allSlots = await tx.orderSupplierSlot.findMany({
      where: { orderId },
      select: { shipmentStage: true },
    });
    const agg = computeAggregate(allSlots);

    // Order.shippedAt = FIRST slot ship moment (when buyer first sees
    // movement). Once set, never overwrite.
    const orderShippedAtPatch = order.shippedAt ? {} : { shippedAt: now };
    // Order.deliveredAt only set when ALL slots Delivered (markSlotShipped
    // never gets there on its own; the Delivered flip lives in
    // markSlotDelivered below). Keep the patch empty here.
    await tx.order.update({
      where: { id: orderId },
      data: {
        shipmentStage: agg.stage,
        // PLH-3g P5: keep Order.carrier/trackingCode mirrored from the
        // most recent ship event for backward-compat with the buyer order
        // page tracking card and the existing CSV/email surfaces. The
        // canonical source is now the slot. Single-supplier orders see
        // the same end state as before P5.
        carrier: carrierClean,
        trackingCode: trackingClean,
        ...orderShippedAtPatch,
      },
    });
    return { allDelivered: agg.allDelivered };
  });

  after(async () => {
    try {
      await writeAuditLog({
        actor: { id: "system", email: "system@partsport" },
        action: "SLOT_SHIPPED",
        targetType: "OrderSupplierSlot",
        targetId: slotId,
        summary: `Slot ${slotId} shipped via ${carrierClean} (${trackingClean})`,
        metadata: {
          slotId,
          orderId,
          supplierId,
          carrier: carrierClean,
          trackingCode: trackingClean,
        },
      });
    } catch (err) {
      captureError(err, { subsystem: "audit", op: "SLOT_SHIPPED", slotId });
    }
  });

  after(async () => {
    try {
      const fresh = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (fresh) await sendOrderShipped(fresh);
    } catch (err) {
      console.error("[email] order-shipped failed:", err);
    }
  });
  after(async () => {
    try {
      // ensurePayoutsForOrder iterates all slots and skips slots whose
      // payout is already PAID/PROCESSING (idempotent). Calling it on
      // every slot ship is safe; only the just-shipped supplier's slot
      // produces a new transfer.
      await ensurePayoutsForOrder(orderId);
    } catch (err) {
      console.error("[payouts] create-on-dispatch failed:", err);
    }
  });

  void allDelivered;
  return { ok: true };
}

/**
 * Flip a slot to Delivered. Recomputes the parent Order aggregate;
 * sets Order.deliveredAt and Order.status="FULFILLED" only when ALL
 * slots have reached Delivered (the 30-day return window opens then).
 * Returns the updated Order row (including items) so the caller can
 * fire sendOrderDelivered when the order fully delivered for the first
 * time.
 */
export async function markSlotDelivered(
  slotId: string
): Promise<
  | { ok: true; orderFullyDeliveredNow: boolean; orderId: string }
  | MarkShippedError
> {
  const slot = await prisma.orderSupplierSlot.findUnique({
    where: { id: slotId },
    select: { id: true, orderId: true, shipmentStage: true },
  });
  if (!slot) return { ok: false, status: 404, error: "Shipment slot not found." };
  if (slot.shipmentStage === "Delivered") {
    return { ok: true, orderFullyDeliveredNow: false, orderId: slot.orderId };
  }
  const orderId = slot.orderId;

  const result = await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.orderSupplierSlot.update({
      where: { id: slotId },
      data: {
        shipmentStage: "Delivered",
        deliveredAt: now,
        // If a Delivered flip happens without an intervening Shipped
        // (admin force-deliver), at least record shippedAt as well so
        // metrics aren't NULL.
        shippedAt: slot.shipmentStage === "Shipped" ? undefined : now,
      },
    });
    const allSlots = await tx.orderSupplierSlot.findMany({
      where: { orderId },
      select: { shipmentStage: true },
    });
    const agg = computeAggregate(allSlots);
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) return { fullyDelivered: false };

    const patch: Record<string, unknown> = { shipmentStage: agg.stage };
    if (agg.allDelivered) {
      if (!order.deliveredAt) patch.deliveredAt = now;
      if (order.status === "PAID") patch.status = "FULFILLED";
    }
    await tx.order.update({ where: { id: orderId }, data: patch });
    return { fullyDelivered: agg.allDelivered && !order.deliveredAt };
  });

  return {
    ok: true,
    orderFullyDeliveredNow: result.fullyDelivered,
    orderId,
  };
}

/**
 * Backward-compat wrapper. Pre-PLH-3g P5 callers passed (orderId,
 * carrier, trackingCode). We find every Pending/Processing slot on the
 * order and ship them all with the same tracking. This preserves the
 * single-supplier-order end state (one slot ships, aggregate flips to
 * Shipped) without forcing every caller to be slot-aware.
 *
 * Multi-supplier orders calling this wrapper will mark ALL their slots
 * shipped under one carrier/tracking, which is rarely what you want
 * for a real multi-supplier dispatch. New per-supplier UI paths should
 * call markSlotShipped directly.
 */
export async function markOrderShipped(
  orderId: string,
  carrier: string,
  trackingCode: string
): Promise<MarkShippedResult | MarkShippedError> {
  const carrierClean = carrier.trim();
  const trackingClean = trackingCode.trim();
  if (!carrierClean || !trackingClean) {
    return {
      ok: false,
      status: 400,
      error: "Carrier and tracking code are required to mark shipped.",
    };
  }
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { supplierSlots: true },
  });
  if (!order) {
    return { ok: false, status: 404, error: "Order not found." };
  }
  if (order.status !== "PAID" && order.status !== "FULFILLED") {
    return {
      ok: false,
      status: 400,
      error: "Only paid orders can be marked shipped.",
    };
  }
  if (order.shipmentStage === "Delivered") {
    return { ok: false, status: 400, error: "Order is already delivered." };
  }
  const pending = order.supplierSlots.filter(
    (s) => s.shipmentStage !== "Shipped" && s.shipmentStage !== "Delivered"
  );
  if (pending.length === 0) {
    return { ok: true, alreadyShipped: true };
  }
  for (const slot of pending) {
    const r = await markSlotShipped(slot.id, {
      carrier: carrierClean,
      trackingCode: trackingClean,
    });
    if (!r.ok) return r;
  }
  return { ok: true };
}

/**
 * Backward-compat wrapper for the Delivered transition. Flips every
 * not-yet-Delivered slot. Returns whether the order JUST transitioned to
 * fully Delivered (so the caller can fire sendOrderDelivered once).
 */
export async function markOrderDelivered(
  orderId: string
): Promise<{ ok: true; orderFullyDeliveredNow: boolean } | MarkShippedError> {
  const slots = await prisma.orderSupplierSlot.findMany({
    where: { orderId },
    select: { id: true, shipmentStage: true },
  });
  if (slots.length === 0) {
    // Defensive: no slots exist (shouldn't happen post-P1 backfill). Flip
    // the order directly and return.
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { ok: false, status: 404, error: "Order not found." };
    if (order.shipmentStage === "Delivered") {
      return { ok: true, orderFullyDeliveredNow: false };
    }
    await prisma.order.update({
      where: { id: orderId },
      data: {
        shipmentStage: "Delivered",
        status: "FULFILLED",
        ...(order.deliveredAt ? {} : { deliveredAt: new Date() }),
      },
    });
    return { ok: true, orderFullyDeliveredNow: !order.deliveredAt };
  }
  let fullyDeliveredNow = false;
  for (const s of slots) {
    if (s.shipmentStage === "Delivered") continue;
    const r = await markSlotDelivered(s.id);
    if (!r.ok) return r;
    if (r.orderFullyDeliveredNow) fullyDeliveredNow = true;
  }
  return { ok: true, orderFullyDeliveredNow: fullyDeliveredNow };
}

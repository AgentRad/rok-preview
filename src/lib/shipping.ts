import "server-only";
import { after } from "next/server";
import { prisma } from "./db";
import { sendOrderShipped } from "./email";
import { ensurePayoutsForOrder } from "./payouts";

/**
 * Mark an order Shipped. Single source of truth for the Shipped transition,
 * called by both /api/ops/orders/[id] (admin) and /api/orders/[id]/fulfill
 * (supplier). Validates inputs, writes carrier + trackingCode, schedules
 * the shipped email and the supplier payout creation via Next 15 `after()`
 * so they're guaranteed to run after the response is sent (no more
 * Vercel-function-terminates-mid-fire-and-forget races).
 *
 * Idempotent: if the order is already in shipmentStage === "Shipped", we
 * skip the write and the side effects. Caller is responsible for
 * authorization (admin role, or supplier ownership of the product).
 */
export type MarkShippedResult = {
  ok: true;
  /** True when the order was already in Shipped state; nothing was changed. */
  alreadyShipped?: boolean;
};

export type MarkShippedError = {
  ok: false;
  status: number;
  error: string;
};

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
  const order = await prisma.order.findUnique({ where: { id: orderId } });
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
    return {
      ok: false,
      status: 400,
      error: "Order is already delivered.",
    };
  }
  // Idempotent: if already Shipped, do nothing. Avoids re-firing the
  // shipped-confirmation email and re-creating duplicate payouts when the
  // supplier clicks the button twice or a retried POST lands.
  if (order.shipmentStage === "Shipped") {
    return { ok: true, alreadyShipped: true };
  }
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      shipmentStage: "Shipped",
      carrier: carrierClean,
      trackingCode: trackingClean,
    },
    include: { items: true },
  });
  // after() (Next 15) holds the serverless function alive until these
  // background tasks complete, so the buyer's shipped email and the
  // supplier payout row are guaranteed even though the response has
  // already returned 200.
  after(async () => {
    try {
      await sendOrderShipped(updated);
    } catch (err) {
      console.error("[email] order-shipped failed:", err);
    }
  });
  after(async () => {
    try {
      await ensurePayoutsForOrder(orderId);
    } catch (err) {
      console.error("[payouts] create-on-dispatch failed:", err);
    }
  });
  return { ok: true };
}

import "server-only";
import { prisma } from "./db";
import { sendOrderShipped } from "./email";
import { ensurePayoutsForOrder } from "./payouts";

/**
 * Mark an order Shipped. Single source of truth for the Shipped transition,
 * called by both /api/ops/orders/[id] (admin) and /api/orders/[id]/fulfill
 * (supplier). Validates inputs, writes carrier + trackingCode, emits the
 * shipped email, and creates the supplier payouts.
 *
 * Throws on invalid state or missing fields. Caller is responsible for
 * authorization (admin role, or supplier ownership of the product).
 */
export type MarkShippedResult = {
  ok: true;
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
  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      shipmentStage: "Shipped",
      carrier: carrierClean,
      trackingCode: trackingClean,
    },
    include: { items: true },
  });
  sendOrderShipped(updated).catch((err) =>
    console.error("[email] order-shipped failed:", err)
  );
  ensurePayoutsForOrder(orderId).catch((err) =>
    console.error("[payouts] create-on-dispatch failed:", err)
  );
  return { ok: true };
}

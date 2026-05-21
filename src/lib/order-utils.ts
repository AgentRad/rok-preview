import "server-only";
import { prisma } from "./db";

export function generateReference(prefix = "PP"): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

/** Marks a PENDING order as PAID and decrements product stock. Idempotent. */
export async function markOrderPaid(
  orderId: string,
  paymentMethod: string,
  paypalOrderId?: string
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) return false;
    if (order.status !== "PENDING") return true; // already processed

    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.qty } },
      });
    }
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: "PAID",
        paidAt: new Date(),
        paymentMethod,
        ...(paypalOrderId ? { paypalOrderId } : {}),
      },
    });
    return true;
  });
}

import "server-only";
import { prisma } from "./db";
import { generateReference } from "./order-utils";

/**
 * Creates one Payout row per supplier in the order when it is dispatched.
 * Idempotent: re-running on the same order leaves existing payouts alone.
 * Amount per supplier is the sum of unitPriceCents x qty for the items that
 * belong to that supplier (i.e., the part price, no freight or fee).
 */
export async function ensurePayoutsForOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } } },
  });
  if (!order) return;
  if (order.status !== "PAID" && order.status !== "FULFILLED") return;

  const totalsBySupplier = new Map<string, number>();
  for (const item of order.items) {
    const id = item.product.supplierId;
    const amount = (totalsBySupplier.get(id) ?? 0) + item.unitPriceCents * item.qty;
    totalsBySupplier.set(id, amount);
  }

  for (const [supplierId, amountCents] of totalsBySupplier) {
    const existing = await prisma.payout.findUnique({
      where: { supplierId_orderId: { supplierId, orderId } },
    });
    if (existing) continue;
    try {
      await prisma.payout.create({
        data: {
          reference: generateReference("PAY"),
          supplierId,
          orderId,
          amountCents,
        },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "P2002") throw err;
    }
  }
}

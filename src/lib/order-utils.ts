import "server-only";
import { prisma } from "./db";
import { sendPaymentReceived } from "./email";

export function generateReference(prefix = "PP"): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

/** Deterministic invoice number, one per order, derived from the order reference. */
export function invoiceNumberFor(orderReference: string): string {
  return `INV-${orderReference}`;
}

/** Marks a PENDING order as PAID, decrements stock, and issues an invoice. Idempotent. */
export async function markOrderPaid(
  orderId: string,
  paymentMethod: string,
  paypalOrderId?: string,
  /**
   * Optional Stripe Tax snapshot. When the payment provider returns a
   * computed tax amount, we write it into Order.taxCents and re-derive
   * totalCents so the invoice matches what the buyer was charged.
   */
  taxSnapshot?: { taxCents: number; amountTotalCents?: number }
): Promise<boolean> {
  const wasPending = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) return false;
    if (order.status !== "PENDING") return null; // already processed

    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.qty } },
      });
    }

    // Snapshot the tax (and recompute totalCents) only when a real engine
    // returned one. The demo / PayPal sandbox path keeps tax at 0.
    const taxUpdate =
      taxSnapshot && taxSnapshot.taxCents > 0
        ? {
            taxCents: taxSnapshot.taxCents,
            totalCents:
              taxSnapshot.amountTotalCents ??
              order.subtotalCents +
                order.freightCents +
                order.feeCents +
                taxSnapshot.taxCents,
          }
        : {};
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: "PAID",
        paidAt: new Date(),
        paymentMethod,
        // Seed the shipment stage at payment time. Without this the order
        // sits with shipmentStage = "" until Mark Shipped runs, and the
        // buyer's timeline visually skips the Processing dot. Only set
        // when the order is freshly PAID and not yet further along.
        shipmentStage: "Processing",
        ...(paypalOrderId ? { paypalOrderId } : {}),
        ...taxUpdate,
      },
    });
    return true;
  });

  if (wasPending === false) return false;
  await ensureInvoiceForOrder(orderId);

  if (wasPending === true) {
    const paidOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (paidOrder) {
      sendPaymentReceived(paidOrder).catch((err) =>
        console.error("[email] payment-received failed:", err)
      );
    }
  }
  return true;
}

/**
 * Creates an Invoice for a paid order if one doesn't already exist. Idempotent.
 * Snapshots the four-component pricing (subtotal, freight, fee, tax) and total.
 */
export async function ensureInvoiceForOrder(orderId: string): Promise<void> {
  const existing = await prisma.invoice.findUnique({ where: { orderId } });
  if (existing) return;

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return;
  if (order.status === "PENDING" || order.status === "CANCELLED") return;

  try {
    await prisma.invoice.create({
      data: {
        number: invoiceNumberFor(order.reference),
        orderId: order.id,
        status: "PAID",
        subtotalCents: order.subtotalCents,
        freightCents: order.freightCents,
        feeCents: order.feeCents,
        taxCents: order.taxCents,
        totalCents: order.totalCents,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        shipTo: order.shipTo,
      },
    });
  } catch (err) {
    // P2002 = unique constraint, raced with another writer; safe to ignore.
    const code = (err as { code?: string }).code;
    if (code !== "P2002") throw err;
  }
}

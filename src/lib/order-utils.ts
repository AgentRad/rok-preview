import "server-only";
import { after } from "next/server";
import { prisma } from "./db";
import { sendPaymentReceived, sendInvoiceIssued } from "./email";
import { captureError } from "./observability";
import { intuitConfigured } from "./qbo-auth";
import { syncInvoice } from "./qbo-sync";

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
      // after() keeps the serverless function alive past the response so
      // the email is guaranteed to fire. markOrderPaid is called from the
      // webhook handler and the success-page reconcile flow, both running
      // inside a request context where after() is valid.
      after(async () => {
        try {
          await sendPaymentReceived(paidOrder);
        } catch (err) {
          captureError(err, { subsystem: "email", op: "payment-received", orderId });
        }
      });

      // PLH-3i P2: push the freshly paid Order to QuickBooks Online as a
      // Customer + Invoice pair. Feature is gated on intuitConfigured() so
      // dev / pre-connect deployments skip silently. Errors are swallowed
      // at the after() boundary AFTER syncInvoice writes its own
      // QBO_SYNC_FAILED audit row + captureError, so a QBO outage cannot
      // break the buyer-facing payment flow.
      if (intuitConfigured()) {
        after(async () => {
          try {
            await syncInvoice({
              id: paidOrder.id,
              reference: paidOrder.reference,
              buyerId: paidOrder.buyerId,
              buyerEmail: paidOrder.buyerEmail,
              buyerName: paidOrder.buyerName,
              shipTo: paidOrder.shipTo,
              subtotalCents: paidOrder.subtotalCents,
              freightCents: paidOrder.freightCents,
              feeCents: paidOrder.feeCents,
              taxCents: paidOrder.taxCents,
              totalCents: paidOrder.totalCents,
              items: paidOrder.items.map((i) => ({
                nameSnapshot: i.nameSnapshot,
                skuSnapshot: i.skuSnapshot,
                unitPriceCents: i.unitPriceCents,
                qty: i.qty,
              })),
            });
          } catch {
            // already audited + captured inside syncInvoice
          }
        });
      }
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

/**
 * PLH-3z-1: create a DUE invoice for a net-terms order at order-create time and
 * email it. Unlike ensureInvoiceForOrder (which fires on PAID and marks the
 * invoice PAID), this runs while the order is still PENDING because net-terms
 * billing issues the invoice up front with a due date. Idempotent. Emails the
 * buyer via sendInvoiceIssued through after() so a mail hiccup can't fail the
 * order.
 */
export async function ensureNetTermsInvoiceForOrder(orderId: string): Promise<void> {
  const existing = await prisma.invoice.findUnique({ where: { orderId } });
  if (existing) return;

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return;
  // Only net-terms orders get an up-front DUE invoice. PREPAID orders keep
  // using ensureInvoiceForOrder on payment.
  if (order.paymentTerms === "PREPAID") return;

  try {
    await prisma.invoice.create({
      data: {
        number: invoiceNumberFor(order.reference),
        orderId: order.id,
        status: "DUE",
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
    const code = (err as { code?: string }).code;
    if (code !== "P2002") throw err;
    return;
  }

  after(async () => {
    try {
      await sendInvoiceIssued({
        id: order.id,
        reference: order.reference,
        buyerId: order.buyerId,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        buyerCompanyName: order.buyerCompanyName,
        buyerCompanyLogoUrl: order.buyerCompanyLogoUrl,
        totalCents: order.totalCents,
        subtotalCents: order.subtotalCents,
        freightCents: order.freightCents,
        feeCents: order.feeCents,
        taxCents: order.taxCents,
        feeRateBps: order.feeRateBps,
        shipTo: order.shipTo,
        purchaseOrderNumber: order.purchaseOrderNumber,
        paymentTerms: order.paymentTerms,
        invoiceDueDate: order.invoiceDueDate,
        items: [],
      });
    } catch (err) {
      captureError(err, { subsystem: "email", op: "invoice-issued", orderId: order.id });
    }
  });
}

import { prisma } from "@/lib/db";
import { intuitConfigured } from "@/lib/qbo-auth";
import { syncInvoice, syncRefund } from "@/lib/qbo-sync";
import { captureError } from "@/lib/observability";

/**
 * PLH-3i P5: shared reconcile helper. Body lifted out of the
 * /api/cron/qbo-reconcile route so both the cron and the admin
 * "Run reconcile now" button at /admin/integrations/quickbooks can
 * call the same code path. See the cron route for the full doc
 * block on the two-pass design.
 */

const MAX_PER_RUN = 200;

export type ReconcileResult =
  | { ok: true; skipped: string }
  | {
      ok: true;
      invoiceProcessed: number;
      invoiceSucceeded: number;
      invoiceFailed: number;
      refundProcessed: number;
      refundSucceeded: number;
      refundFailed: number;
      hasMoreInvoices: boolean;
      hasMoreRefunds: boolean;
    };

export async function runQboReconcile(opts?: {
  op?: string;
}): Promise<ReconcileResult> {
  const op = opts?.op ?? "qbo-reconcile";

  if (!intuitConfigured()) {
    return { ok: true, skipped: "intuit not configured" };
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // ----- Pass 1: invoice backfill -----
  const invoiceRows = await prisma.invoice.findMany({
    where: {
      qboInvoiceId: null,
      order: {
        status: "PAID",
        paidAt: { gt: cutoff },
      },
    },
    orderBy: { order: { paidAt: "asc" } },
    take: MAX_PER_RUN,
    include: {
      order: {
        include: { items: true },
      },
    },
  });

  let invoiceProcessed = 0;
  let invoiceSucceeded = 0;
  let invoiceFailed = 0;

  for (const inv of invoiceRows) {
    invoiceProcessed++;
    const order = inv.order;
    if (!order) {
      invoiceFailed++;
      continue;
    }
    try {
      await syncInvoice({
        id: order.id,
        reference: order.reference,
        buyerId: order.buyerId,
        buyerEmail: order.buyerEmail,
        buyerName: order.buyerName,
        shipTo: order.shipTo,
        subtotalCents: order.subtotalCents,
        freightCents: order.freightCents,
        feeCents: order.feeCents,
        taxCents: order.taxCents,
        totalCents: order.totalCents,
        items: order.items.map((i) => ({
          nameSnapshot: i.nameSnapshot,
          skuSnapshot: i.skuSnapshot,
          unitPriceCents: i.unitPriceCents,
          qty: i.qty,
        })),
      });
      invoiceSucceeded++;
    } catch (err) {
      invoiceFailed++;
      captureError(err, {
        subsystem: "cron",
        op: `${op}-invoice`,
        orderId: order.id,
      });
    }
  }

  // ----- Pass 2: refund backfill -----
  const refundRows = await prisma.refund.findMany({
    where: {
      qboRefundReceiptId: null,
      createdAt: { gt: cutoff },
      order: {
        invoice: {
          qboInvoiceId: { not: null },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_PER_RUN,
    select: {
      id: true,
      orderId: true,
      amountCents: true,
    },
  });

  let refundProcessed = 0;
  let refundSucceeded = 0;
  let refundFailed = 0;

  for (const r of refundRows) {
    refundProcessed++;
    try {
      await syncRefund({
        orderId: r.orderId,
        refundId: r.id,
        amountCents: r.amountCents,
        slotSupplierName: null,
      });
      refundSucceeded++;
    } catch (err) {
      refundFailed++;
      captureError(err, {
        subsystem: "cron",
        op: `${op}-refund`,
        orderId: r.orderId,
        refundId: r.id,
      });
    }
  }

  return {
    ok: true,
    invoiceProcessed,
    invoiceSucceeded,
    invoiceFailed,
    refundProcessed,
    refundSucceeded,
    refundFailed,
    hasMoreInvoices: invoiceProcessed === MAX_PER_RUN,
    hasMoreRefunds: refundProcessed === MAX_PER_RUN,
  };
}

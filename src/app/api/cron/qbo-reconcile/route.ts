import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { intuitConfigured } from "@/lib/qbo-auth";
import { syncInvoice, syncRefund } from "@/lib/qbo-sync";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * PLH-3i P4: daily QuickBooks Online reconciliation cron.
 *
 * Two passes per run, both bounded:
 *
 * 1. Invoice backfill. Walk Invoices with qboInvoiceId IS NULL whose
 *    Order is PAID and was paid in the last 30 days. These are orders
 *    where the markOrderPaid after() block fired but the QBO push
 *    failed (QBO disconnected at the time, Intuit outage, token
 *    revoked, rate-limited). Retry syncInvoice per row.
 *
 * 2. Refund backfill. Walk Refunds with qboRefundReceiptId IS NULL
 *    whose Invoice has a qboInvoiceId set (we need a real QBO invoice
 *    to anchor the RefundReceipt against), created in the last 30
 *    days. Retry syncRefund per row.
 *
 * Both passes are MAX_PER_RUN=200 with ASC ordering and a hasMore
 * flag in the response so a backlog gets flushed across consecutive
 * daily runs. Mirrors PLH-2 Phase 4e + PLH-3e B9 cron patterns.
 *
 * Per-row failures are caught + counted; the batch never aborts on
 * one bad row. syncInvoice + syncRefund already write
 * QBO_SYNC_FAILED audit rows + captureError on failure (PLH-3i P2 +
 * P3), so this cron does NOT duplicate that work; the catch here is
 * just to keep the loop alive.
 *
 * Feature gate: when intuitConfigured() is false (no Intuit env
 * vars) the route returns ok + skipped so the cron stays a no-op in
 * dev / pre-connect deployments.
 *
 * Schedule: 07:00 UTC daily (vercel.json). Sits between the morning
 * housekeeping crons at 03/04/05/06 and the money-ops crons that
 * start at 09:00, so a fresh-from-overnight QBO push has time to
 * settle before the daily reserve-release and payout-retry runs.
 */

const MAX_PER_RUN = 200;

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!intuitConfigured()) {
    return NextResponse.json({ ok: true, skipped: "intuit not configured" });
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
      // syncInvoice already wrote QBO_SYNC_FAILED + captureError; this
      // catch only keeps the loop alive. Capture once more with the
      // cron op tag so the cron run is searchable in Sentry.
      captureError(err, {
        subsystem: "cron",
        op: "qbo-reconcile-invoice",
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
        // Refund rows don't carry slot context; the slot supplier name
        // is a display-only field on the QBO RefundReceipt
        // description. Reconcile backfill posts without it.
        slotSupplierName: null,
      });
      refundSucceeded++;
    } catch (err) {
      refundFailed++;
      captureError(err, {
        subsystem: "cron",
        op: "qbo-reconcile-refund",
        orderId: r.orderId,
        refundId: r.id,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    invoiceProcessed,
    invoiceSucceeded,
    invoiceFailed,
    refundProcessed,
    refundSucceeded,
    refundFailed,
    hasMoreInvoices: invoiceProcessed === MAX_PER_RUN,
    hasMoreRefunds: refundProcessed === MAX_PER_RUN,
  });
}

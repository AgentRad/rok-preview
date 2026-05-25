import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { createTransferToSupplier } from "@/lib/stripe-connect";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";
import { generateReference } from "@/lib/order-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RELEASE_AFTER_DAYS = 60;

/**
 * Daily cron: release reserves on orders that are RELEASE_AFTER_DAYS old
 * with no refund and no open dispute. Pulls the reserved amount out of
 * Supplier.reserveBalanceCents, transfers it to the supplier (when
 * Connect is active), and records a RELEASE SupplierReserveTransaction.
 *
 * Idempotent: orders are matched on Order.reservedCents > 0; the
 * release transaction clears reservedCents on the way out so a re-run
 * doesn't double-release.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const cutoff = new Date(Date.now() - RELEASE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await prisma.order.findMany({
    where: {
      reservedCents: { gt: 0 },
      paidAt: { lt: cutoff },
      refundedCents: 0,
      // Skip orders with any non-resolved return; that's a money-at-risk signal.
      returns: {
        none: { status: { in: ["OPEN", "APPROVED"] } },
      },
    },
    include: {
      items: { include: { product: { select: { supplierId: true } } } },
      payouts: true,
    },
  });

  const released: { orderId: string; supplierId: string; amountCents: number }[] = [];
  for (const order of candidates) {
    // Per-supplier share of the order's reservedCents, matched to the
    // payout row that recorded the HOLD.
    for (const payout of order.payouts) {
      if (payout.reservedCents <= 0) continue;
      const supplier = await prisma.supplier.findUnique({
        where: { id: payout.supplierId },
      });
      if (!supplier) continue;
      const drawCents = Math.min(payout.reservedCents, supplier.reserveBalanceCents);
      if (drawCents <= 0) continue;
      try {
        // Move the reserve out of held balance...
        await prisma.$transaction([
          prisma.supplier.update({
            where: { id: supplier.id },
            data: { reserveBalanceCents: { decrement: drawCents } },
          }),
          prisma.supplierReserveTransaction.create({
            data: {
              supplierId: supplier.id,
              type: "RELEASE",
              amountCents: drawCents,
              orderId: order.id,
              reason: `Auto-release after ${RELEASE_AFTER_DAYS} days, no refund or open dispute`,
            },
          }),
          prisma.payout.update({
            where: { id: payout.id },
            data: { reservedCents: { decrement: drawCents } },
          }),
          prisma.order.update({
            where: { id: order.id },
            data: { reservedCents: { decrement: drawCents } },
          }),
        ]);
        // ...then send it to the supplier via an extra transfer when
        // they're Connect-active. Otherwise the released balance just
        // becomes part of the platform's owings on the next manual
        // payout cycle (legacy path).
        if (supplier.stripeAccountId && supplier.stripePayoutsEnabled) {
          await createTransferToSupplier({
            supplier,
            amountCents: drawCents,
            orderId: order.id,
            payoutReference: generateReference("RES"),
          });
        }
        released.push({
          orderId: order.id,
          supplierId: supplier.id,
          amountCents: drawCents,
        });
        await writeAuditLog({
          actor: { id: "system", email: "system@partsport" },
          action: "PAYOUT_MARKED_PAID",
          targetType: "Payout",
          targetId: payout.id,
          summary: `Reserve released: ${drawCents} cents for ${supplier.name} on order ${order.reference}`,
          metadata: {
            orderReference: order.reference,
            supplierId: supplier.id,
            drawCents,
          },
        });
      } catch (err) {
        captureError(err, {
          subsystem: "reserve-release",
          orderId: order.id,
          supplierId: supplier.id,
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    cutoffDays: RELEASE_AFTER_DAYS,
    scanned: candidates.length,
    released,
  });
}

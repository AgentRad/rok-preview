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
const MAX_PER_RUN = 200;

/**
 * Daily cron: release reserves on orders that are RELEASE_AFTER_DAYS old
 * with no refund and no open dispute. Pulls the reserved amount out of
 * Supplier.reserveBalanceCents, transfers it to the supplier (when
 * Connect is active), and records a RELEASE SupplierReserveTransaction.
 *
 * PLH-2 Phase 4e (E3): two-stage release so the Stripe transfer fires
 * AFTER the row is staked out but BEFORE reserveBalanceCents is
 * decremented. Pre-fix the DB transaction decremented reserveBalanceCents
 * and wrote the RELEASE row, then the Stripe transfer fired afterwards.
 * If the transfer failed, the reserve had already been "released" on the
 * books with no money actually leaving the platform. Same money-leak
 * pattern as P12 C3 on the payouts path.
 *
 * New three-stage flow:
 *   Stage 1 (DB tx): create a PENDING SupplierReserveTransaction noting
 *     the planned drawCents. reserveBalanceCents is NOT decremented yet.
 *   Stage 2 (no tx, network): createTransferToSupplier (Connect-active
 *     suppliers only; non-Connect suppliers skip Stage 2 and Stage 3
 *     just settles the books).
 *   Stage 3a SUCCESS (new tx): flip PENDING row to COMPLETED, decrement
 *     reserveBalanceCents (re-read fresh, Math.min on current balance),
 *     decrement Payout.reservedCents and Order.reservedCents, write
 *     PAYOUT_MARKED_PAID audit.
 *   Stage 3b FAILURE (new tx): flip PENDING row to FAILED with the
 *     failure reason. reserveBalanceCents stays untouched. The next
 *     cron run picks the order up again.
 *
 * PLH-2 Phase 4e (E4): cap at MAX_PER_RUN candidates per invocation and
 * sort by paidAt ASC so the oldest backlog clears first. Surfaces
 * `hasMore: true` so the next run knows to keep going.
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
      returns: {
        none: { status: { in: ["OPEN", "APPROVED"] } },
      },
    },
    orderBy: { paidAt: "asc" },
    take: MAX_PER_RUN + 1,
    include: {
      items: { include: { product: { select: { supplierId: true } } } },
      payouts: true,
    },
  });

  const hasMore = candidates.length > MAX_PER_RUN;
  const batch = hasMore ? candidates.slice(0, MAX_PER_RUN) : candidates;

  const released: { orderId: string; supplierId: string; amountCents: number }[] = [];
  const failed: { orderId: string; supplierId: string; reason: string }[] = [];

  for (const order of batch) {
    for (const payout of order.payouts) {
      if (payout.reservedCents <= 0) continue;
      const supplier = await prisma.supplier.findUnique({
        where: { id: payout.supplierId },
      });
      if (!supplier) continue;
      const drawCents = Math.min(payout.reservedCents, supplier.reserveBalanceCents);
      if (drawCents <= 0) continue;

      // STAGE 1: stake out the release. NO reserveBalanceCents
      // decrement here. The row is the receipt that lets Stage 3
      // recover if this process dies between Stage 2 and Stage 3.
      let pendingTxId: string;
      try {
        const fresh = await prisma.order.findUnique({
          where: { id: order.id },
          select: { refundedCents: true, reservedCents: true },
        });
        if (!fresh) continue;
        if (fresh.refundedCents > 0) {
          // Refund snuck in between selection and Stage 1. Skip.
          continue;
        }
        const created = await prisma.supplierReserveTransaction.create({
          data: {
            supplierId: supplier.id,
            type: "RELEASE",
            status: "PENDING",
            amountCents: drawCents,
            orderId: order.id,
            reason: `Pending auto-release after ${RELEASE_AFTER_DAYS} days, no refund or open dispute`,
          },
        });
        pendingTxId = created.id;
      } catch (err) {
        captureError(err, {
          subsystem: "reserve-release",
          op: "stage1",
          orderId: order.id,
          supplierId: supplier.id,
        });
        continue;
      }

      // STAGE 2: send the cash. Connect-active suppliers only. For
      // legacy non-Connect suppliers the released balance just stays on
      // the platform's books and gets paid out manually on the next
      // cycle. There is no network call to fail, so we drop straight
      // into Stage 3a.
      let transferFailed = false;
      let transferFailReason = "";
      if (supplier.stripeAccountId && supplier.stripePayoutsEnabled) {
        try {
          await createTransferToSupplier({
            supplier,
            amountCents: drawCents,
            orderId: order.id,
            payoutReference: generateReference("RES"),
          });
        } catch (err) {
          transferFailed = true;
          transferFailReason =
            err instanceof Error ? err.message.slice(0, 500) : "Unknown";
          captureError(err, {
            subsystem: "reserve-release",
            op: "stage2-transfer",
            orderId: order.id,
            supplierId: supplier.id,
            pendingTxId,
          });
        }
      }

      if (transferFailed) {
        // STAGE 3b: mark the PENDING row failed. reserveBalanceCents
        // stays untouched. Next cron run will retry the order.
        try {
          await prisma.supplierReserveTransaction.update({
            where: { id: pendingTxId },
            data: {
              status: "FAILED",
              reason: `Transfer failed: ${transferFailReason}`,
            },
          });
        } catch (err) {
          captureError(err, {
            subsystem: "reserve-release",
            op: "stage3b-mark-failed",
            orderId: order.id,
            supplierId: supplier.id,
            pendingTxId,
          });
        }
        failed.push({
          orderId: order.id,
          supplierId: supplier.id,
          reason: transferFailReason,
        });
        continue;
      }

      // STAGE 3a SUCCESS: settle the books. Re-read reserve balance
      // inside the tx and Math.min on the fresh value so a concurrent
      // refund-clawback landing between Stage 1 and Stage 3 cannot push
      // reserveBalanceCents below zero.
      try {
        const settled = await prisma.$transaction(async (tx) => {
          const recheck = await tx.order.findUnique({
            where: { id: order.id },
            select: { refundedCents: true },
          });
          if (!recheck) return 0;
          if (recheck.refundedCents > 0) {
            // Cash already left the platform via the Stripe transfer.
            // The supplier got the reserve. Mark the row COMPLETED so
            // the books match the cash, but DO NOT decrement
            // reserveBalanceCents (the clawback already did). This is
            // a known edge case: the platform now owes itself the
            // shortfall and a future refund clawback may add to
            // Supplier.owedToPlatformCents. Note it on the audit row.
            await tx.supplierReserveTransaction.update({
              where: { id: pendingTxId },
              data: {
                status: "COMPLETED",
                reason: `Released ${drawCents} cents, but a refund landed between Stage 1 and Stage 3; reserveBalanceCents already adjusted by clawback path`,
              },
            });
            return drawCents;
          }
          const freshSupplier = await tx.supplier.findUnique({
            where: { id: supplier.id },
            select: { reserveBalanceCents: true },
          });
          const safeDraw = Math.min(
            drawCents,
            freshSupplier?.reserveBalanceCents ?? 0
          );
          if (safeDraw > 0) {
            await tx.supplier.update({
              where: { id: supplier.id },
              data: { reserveBalanceCents: { decrement: safeDraw } },
            });
            await tx.payout.update({
              where: { id: payout.id },
              data: { reservedCents: { decrement: safeDraw } },
            });
            await tx.order.update({
              where: { id: order.id },
              data: { reservedCents: { decrement: safeDraw } },
            });
          }
          await tx.supplierReserveTransaction.update({
            where: { id: pendingTxId },
            data: {
              status: "COMPLETED",
              amountCents: safeDraw,
              reason: `Auto-release after ${RELEASE_AFTER_DAYS} days, no refund or open dispute`,
            },
          });
          return safeDraw;
        });
        if (settled > 0) {
          released.push({
            orderId: order.id,
            supplierId: supplier.id,
            amountCents: settled,
          });
          await writeAuditLog({
            actor: { id: "system", email: "system@partsport" },
            action: "PAYOUT_MARKED_PAID",
            targetType: "Payout",
            targetId: payout.id,
            summary: `Reserve released: ${settled} cents for ${supplier.name} on order ${order.reference}`,
            metadata: {
              orderReference: order.reference,
              supplierId: supplier.id,
              drawCents: settled,
              pendingTxId,
            },
          });
        }
      } catch (err) {
        captureError(err, {
          subsystem: "reserve-release",
          op: "stage3a-settle",
          orderId: order.id,
          supplierId: supplier.id,
          pendingTxId,
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    cutoffDays: RELEASE_AFTER_DAYS,
    scanned: batch.length,
    released,
    failed,
    hasMore,
  });
}

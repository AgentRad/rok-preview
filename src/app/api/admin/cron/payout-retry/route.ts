import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { createTransferToSupplier } from "@/lib/stripe-connect";
import { captureError } from "@/lib/observability";
import { settlePayoutSuccess, plannedRecoveryAtRetry } from "@/lib/payouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retry FAILED payouts. Exponential backoff per attempt:
 *   attempt 1 -> 1h, 2 -> 6h, 3 -> 24h, 4 -> 3d, 5 -> 7d (final).
 *
 * Polish 12 C3: when the transfer now succeeds, settlePayoutSuccess()
 * re-computes the owed recovery against the CURRENT supplier balance
 * (not the stale Stage-1 plan) and decrements only inside the same
 * transaction that flips Payout -> PAID. The pre-fix path decremented
 * owed up-front and lost the money on transfer failure.
 */
const MAX_ATTEMPTS = 5;
const BACKOFF_HOURS = [1, 6, 24, 72, 168];
// PLH-3j P6: cap-and-resume so a first-run-after-outage backlog cannot
// time out the Vercel function. ASC by createdAt = oldest first.
const MAX_PER_RUN = 200;

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const found = await prisma.payout.findMany({
    where: {
      status: "FAILED",
      retryAttempts: { lt: MAX_ATTEMPTS },
    },
    include: { supplier: true },
    orderBy: { createdAt: "asc" },
    take: MAX_PER_RUN + 1,
  });
  const hasMore = found.length > MAX_PER_RUN;
  const failed = hasMore ? found.slice(0, MAX_PER_RUN) : found;
  const retried: { payoutId: string; supplierId: string; outcome: string }[] = [];

  for (const payout of failed) {
    const backoffHours =
      BACKOFF_HOURS[payout.retryAttempts] ?? BACKOFF_HOURS[BACKOFF_HOURS.length - 1];
    const eligibleAt = payout.lastRetryAt
      ? payout.lastRetryAt.getTime() + backoffHours * 60 * 60 * 1000
      : 0;
    if (Date.now() < eligibleAt) continue;
    if (!payout.supplier.stripeAccountId || !payout.supplier.stripePayoutsEnabled) {
      retried.push({
        payoutId: payout.id,
        supplierId: payout.supplierId,
        outcome: "skipped-not-connected",
      });
      continue;
    }
    try {
      const transferId = await createTransferToSupplier({
        supplier: payout.supplier,
        amountCents: payout.amountCents,
        orderId: payout.orderId,
        payoutReference: payout.reference,
      });
      // Stage 3a success path. Recompute planned recovery vs current
      // owed balance, then flip to PAID + decrement atomically.
      const planned = await plannedRecoveryAtRetry({
        supplierId: payout.supplierId,
        payoutAmountCents: payout.amountCents,
        noteHint: payout.note,
      });
      await settlePayoutSuccess({
        payoutId: payout.id,
        supplierId: payout.supplierId,
        orderId: payout.orderId,
        payoutReference: payout.reference,
        plannedOwedRecovery: planned,
        stripeTransferId: transferId,
        supplierName: payout.supplier.name,
      });
      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          retryAttempts: { increment: 1 },
          lastRetryAt: new Date(),
          failureReason: "",
        },
      });
      retried.push({
        payoutId: payout.id,
        supplierId: payout.supplierId,
        outcome: "retried",
      });
    } catch (err) {
      captureError(err, {
        subsystem: "payout-retry",
        payoutId: payout.id,
      });
      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          retryAttempts: { increment: 1 },
          lastRetryAt: new Date(),
          failureReason: err instanceof Error ? err.message.slice(0, 500) : "Retry failed",
        },
      });
      retried.push({
        payoutId: payout.id,
        supplierId: payout.supplierId,
        outcome: "retry-failed",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: failed.length,
    retried,
    maxAttempts: MAX_ATTEMPTS,
    hasMore,
  });
}

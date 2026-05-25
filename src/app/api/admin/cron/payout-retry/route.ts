import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { createTransferToSupplier } from "@/lib/stripe-connect";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retry FAILED payouts. Exponential backoff per attempt:
 *   attempt 1 -> 1h after last failure
 *   attempt 2 -> 6h
 *   attempt 3 -> 24h
 *   attempt 4 -> 3d
 *   attempt 5 -> 7d (final auto attempt; after this admin intervention)
 *
 * Caps at MAX_ATTEMPTS so a permanently-broken Connect account doesn't
 * spam Stripe forever.
 */
const MAX_ATTEMPTS = 5;
const BACKOFF_HOURS = [1, 6, 24, 72, 168];

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const failed = await prisma.payout.findMany({
    where: {
      status: "FAILED",
      retryAttempts: { lt: MAX_ATTEMPTS },
    },
    include: { supplier: true },
    take: 200,
  });
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
      await prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: "PROCESSING",
          stripeTransferId: transferId || undefined,
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
  });
}

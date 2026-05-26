import "server-only";
import { prisma } from "./db";
import { generateReference } from "./order-utils";
import {
  createTransferToSupplier,
  hasActiveStripeConnect,
} from "./stripe-connect";
import { captureError } from "./observability";
import { writeAuditLog } from "./audit";

/**
 * Creates one Payout row per supplier in the order when it is dispatched.
 * Idempotent: re-running on the same order leaves existing payouts alone.
 *
 * Polish 12 C3 (money-leak fix). The previous implementation decremented
 * Supplier.owedToPlatformCents BEFORE Stripe accepted the transfer. If
 * Stripe then failed the transfer, the supplier debt was wiped from the
 * books without recovering any money: a quiet leak in PartsPort's favor
 * on the books but against the cash. New ordering:
 *
 *   Stage 1 (DB tx): create Payout with status PROCESSING (Connect)
 *     or DUE (manual), reserve held + recorded, OWED NOT decremented
 *     yet. Planned recovery is stashed on Payout.note so the success
 *     path can replay it.
 *   Stage 2 (no tx, network): createTransferToSupplier(netted amount).
 *   Stage 3a success (new DB tx): Payout -> PAID, stripeTransferId
 *     set, decrement Supplier.owedToPlatformCents by the planned
 *     recovery (re-fetched fresh, Math.min against current balance to
 *     respect the supplier_owed_nonneg CHECK constraint), write
 *     OWED_RECOVERED audit + DRAW_DOWN reserve transaction row.
 *   Stage 3b failure (new DB tx): Payout -> FAILED, leave
 *     owedToPlatformCents alone, schedule via the existing payout-retry
 *     cron which now also re-computes recovery at retry time against
 *     the current owed balance.
 */
export async function ensurePayoutsForOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } } },
  });
  if (!order) return;
  if (order.status !== "PAID" && order.status !== "FULFILLED") return;

  // Sum per-supplier subtotal share (no freight, no fee, no tax).
  const totalsBySupplier = new Map<string, number>();
  for (const item of order.items) {
    const id = item.product.supplierId;
    const amount = (totalsBySupplier.get(id) ?? 0) + item.unitPriceCents * item.qty;
    totalsBySupplier.set(id, amount);
  }

  for (const [supplierId, supplierSubtotalCents] of totalsBySupplier) {
    const existing = await prisma.payout.findUnique({
      where: { supplierId_orderId: { supplierId, orderId } },
    });
    if (existing) continue;

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) continue;

    // Reserve holdback rounded HALF_UP toward the platform.
    const reservedCents = Math.ceil(
      (supplierSubtotalCents * supplier.reservePercent) / 10000
    );
    const grossTransferable = supplierSubtotalCents - reservedCents;
    // Planned recovery is computed up-front off the CURRENT owed balance
    // so the buyer-facing amount on Payout is right, but it is NOT
    // deducted from supplier.owedToPlatformCents yet. The success path
    // re-fetches and uses Math.min against the fresh balance so a
    // concurrent refund landing between Stages 1 and 3 doesn't try to
    // recover more than what is now owed.
    const plannedOwedRecovery = Math.min(
      Math.max(0, supplier.owedToPlatformCents),
      grossTransferable
    );
    const transferableCents = grossTransferable - plannedOwedRecovery;

    const reference = generateReference("PAY");
    const noteForStashing = plannedOwedRecovery > 0
      ? `Planned owed recovery: ${plannedOwedRecovery} cents`
      : "";

    let payoutId: string;
    try {
      // STAGE 1: DB writes only. NO owed decrement here.
      payoutId = await prisma.$transaction(async (tx) => {
        const created = await tx.payout.create({
          data: {
            reference,
            supplierId,
            orderId,
            amountCents: transferableCents,
            reservedCents,
            status: hasActiveStripeConnect(supplier) ? "PROCESSING" : "DUE",
            note: noteForStashing,
          },
        });
        if (reservedCents > 0) {
          await tx.supplierReserveTransaction.create({
            data: {
              supplierId,
              type: "HOLD",
              amountCents: reservedCents,
              orderId,
              reason: `Held back ${supplier.reservePercent / 100}% from payout ${reference}`,
            },
          });
          await tx.supplier.update({
            where: { id: supplierId },
            data: {
              reserveBalanceCents: { increment: reservedCents },
            },
          });
          await tx.order.update({
            where: { id: orderId },
            data: { reservedCents: { increment: reservedCents } },
          });
        }
        return created.id;
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "P2002") {
        captureError(err, {
          subsystem: "payouts",
          op: "ensurePayoutsForOrder",
          supplierId,
          orderId,
        });
      }
      continue;
    }

    // STAGE 2: only fire the Stripe transfer for Connect-active suppliers.
    // Manual payouts stay DUE; admin marks them paid via /ops, which is
    // its own code path and runs through markPayoutPaidAndRecoverOwed
    // below.
    if (!hasActiveStripeConnect(supplier)) continue;

    try {
      const transferId = await createTransferToSupplier({
        supplier,
        amountCents: transferableCents,
        orderId,
        payoutReference: reference,
      });
      // STAGE 3a SUCCESS: settle the owed recovery now that money has
      // actually moved.
      await settlePayoutSuccess({
        payoutId,
        supplierId,
        orderId,
        payoutReference: reference,
        plannedOwedRecovery,
        stripeTransferId: transferId,
        supplierName: supplier.name,
      });
    } catch (err) {
      // STAGE 3b FAILURE: do NOT touch owedToPlatformCents. The retry
      // cron will pick this up. Stash planned recovery on note so the
      // retry can re-derive it (re-fetched fresh at retry time).
      captureError(err, {
        subsystem: "stripe-connect",
        op: "transfer",
        supplierId,
        orderId,
        payoutId,
      });
      await prisma.payout.update({
        where: { id: payoutId },
        data: {
          status: "FAILED",
          failureReason: err instanceof Error ? err.message.slice(0, 500) : "Unknown",
          retryAttempts: { increment: 1 },
          lastRetryAt: new Date(),
        },
      });
      await writeAuditLog({
        actor: { id: "system", email: "system@partsport" },
        action: "PAYOUT_TRANSFER_FAILED",
        targetType: "Payout",
        targetId: payoutId,
        summary: `Transfer FAILED on creation for ${supplier.name}: ${err instanceof Error ? err.message : "Unknown error"}`,
        metadata: {
          supplierId,
          orderId,
          transferableCents,
          plannedOwedRecovery,
        },
      });
    }
  }
}

/**
 * Promote a Payout to PAID and (if any) collect the planned owed
 * recovery. Re-reads the supplier balance INSIDE the transaction and
 * Math.min against it so a concurrent refund landing between Stage 1
 * and Stage 3 cannot push owedToPlatformCents below zero (which the
 * supplier_owed_nonneg CHECK constraint would reject anyway).
 *
 * Shared between the inline success path in ensurePayoutsForOrder and
 * the payout-retry cron. Idempotent: re-running on a PAID payout
 * short-circuits.
 */
export async function settlePayoutSuccess(args: {
  payoutId: string;
  supplierId: string;
  orderId: string;
  payoutReference: string;
  plannedOwedRecovery: number;
  stripeTransferId: string | null;
  supplierName: string;
}): Promise<void> {
  const actualRecovery = await prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: args.payoutId } });
    if (!payout) return 0;
    if (payout.status === "PAID") return 0;
    const fresh = await tx.supplier.findUnique({
      where: { id: args.supplierId },
      select: { owedToPlatformCents: true },
    });
    // Re-fetch owed balance and clamp the planned recovery to what is
    // actually owed RIGHT NOW. Pre-fix the decrement used the stale
    // Stage-1 number and could push the balance negative on a
    // concurrent refund landing in between.
    const recovery = Math.max(
      0,
      Math.min(args.plannedOwedRecovery, fresh?.owedToPlatformCents || 0)
    );
    await tx.payout.update({
      where: { id: args.payoutId },
      data: {
        status: "PAID",
        paidAt: new Date(),
        ...(args.stripeTransferId
          ? { stripeTransferId: args.stripeTransferId }
          : {}),
        note:
          recovery > 0
            ? `Netted ${recovery} cents against prior refund shortfall`
            : payout.note,
      },
    });
    if (recovery > 0) {
      await tx.supplier.update({
        where: { id: args.supplierId },
        data: { owedToPlatformCents: { decrement: recovery } },
      });
      await tx.supplierReserveTransaction.create({
        data: {
          supplierId: args.supplierId,
          type: "DRAW_DOWN",
          amountCents: recovery,
          orderId: args.orderId,
          reason: `Owed to platform: ${recovery} cents recovered against payout ${args.payoutReference}`,
        },
      });
    }
    return recovery;
  });

  if (actualRecovery > 0) {
    const updated = await prisma.supplier.findUnique({
      where: { id: args.supplierId },
      select: { owedToPlatformCents: true },
    });
    await writeAuditLog({
      actor: { id: "system", email: "system@partsport" },
      action: "OWED_RECOVERED",
      targetType: "Supplier",
      targetId: args.supplierId,
      summary: `Recovered ${actualRecovery} cents owed by ${args.supplierName} against payout ${args.payoutReference}`,
      metadata: {
        supplierId: args.supplierId,
        supplierName: args.supplierName,
        orderId: args.orderId,
        payoutId: args.payoutId,
        payoutReference: args.payoutReference,
        amountCents: actualRecovery,
        owedBalanceCents: updated?.owedToPlatformCents ?? 0,
      },
    });
  }
}

/**
 * Re-derive the planned owed recovery for a FAILED payout at retry
 * time. The recovery is the lesser of (a) what the supplier owes right
 * now and (b) the gross transferable amount we could have netted
 * against. Stored on Payout.note as the audit trail for the original
 * Stage-1 plan; here we re-compute fresh because owed may have moved.
 */
export async function plannedRecoveryAtRetry(args: {
  supplierId: string;
  payoutAmountCents: number;
  noteHint: string;
}): Promise<number> {
  const supplier = await prisma.supplier.findUnique({
    where: { id: args.supplierId },
    select: { owedToPlatformCents: true },
  });
  const owed = Math.max(0, supplier?.owedToPlatformCents || 0);
  // The Payout.amountCents is what we actually transfer (net of the
  // original Stage-1 plan). To find the new transferable we add back
  // the original plan from the note hint, if any.
  const m = /Planned owed recovery:\s*(\d+)/i.exec(args.noteHint);
  const originalPlan = m ? Number(m[1]) : 0;
  const grossTransferable = args.payoutAmountCents + originalPlan;
  return Math.min(owed, grossTransferable);
}

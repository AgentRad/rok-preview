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
 * P8 update: when the supplier has Stripe Connect active, also fire the
 * actual Stripe Transfer (less the reserve holdback) and link the
 * transferId to the Payout. The transfer.created webhook later flips
 * status PROCESSING -> PAID. Failures (transfer rejected, network blip)
 * are captured to Sentry and recorded as FAILED so the payout-retry
 * cron (S6) can take another swing.
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

    // Reserve holdback. supplierSubtotalCents * reservePercent / 10000.
    // We round HALF_UP so the supplier never receives an extra cent the
    // reserve was supposed to keep; the rounding favors the platform.
    const reservedCents = Math.ceil(
      (supplierSubtotalCents * supplier.reservePercent) / 10000
    );
    const grossTransferable = supplierSubtotalCents - reservedCents;
    // P9.5 CRIT 5: net any owedToPlatformCents from prior refund shortfalls
    // against this payout. The owed balance accumulated when a refund hit
    // an order whose reserve had already released; we recover it on the
    // next payout. Capped at the payout amount so we never withhold past
    // zero, and the recovered amount is recorded so the audit trail shows
    // the offset.
    const owedRecovery = Math.min(
      Math.max(0, supplier.owedToPlatformCents),
      grossTransferable
    );
    const transferableCents = grossTransferable - owedRecovery;

    const reference = generateReference("PAY");

    try {
      const payout = await prisma.$transaction(async (tx) => {
        // Create the Payout row first so a failed Stripe call leaves a
        // record the retry cron can find.
        const created = await tx.payout.create({
          data: {
            reference,
            supplierId,
            orderId,
            amountCents: transferableCents,
            reservedCents,
            status: hasActiveStripeConnect(supplier) ? "PROCESSING" : "DUE",
            failureReason:
              owedRecovery > 0
                ? `Netted ${owedRecovery} cents against prior refund shortfall`
                : "",
          },
        });
        if (owedRecovery > 0) {
          await tx.supplier.update({
            where: { id: supplierId },
            data: { owedToPlatformCents: { decrement: owedRecovery } },
          });
          await tx.supplierReserveTransaction.create({
            data: {
              supplierId,
              type: "DRAW_DOWN",
              amountCents: owedRecovery,
              orderId,
              reason: `Owed to platform: ${owedRecovery} cents recovered against payout ${reference}`,
            },
          });
        }
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
        return created;
      });

      if (owedRecovery > 0) {
        const updated = await prisma.supplier.findUnique({
          where: { id: supplierId },
          select: { owedToPlatformCents: true },
        });
        await writeAuditLog({
          actor: { id: "system", email: "system@partsport" },
          action: "OWED_RECOVERED",
          targetType: "Supplier",
          targetId: supplierId,
          summary: `Recovered ${owedRecovery} cents owed by ${supplier.name} against payout ${reference}`,
          metadata: {
            supplierId,
            supplierName: supplier.name,
            orderId,
            payoutId: payout.id,
            payoutReference: reference,
            amountCents: owedRecovery,
            owedBalanceCents: updated?.owedToPlatformCents ?? 0,
          },
        });
      }

      // Fire the actual Stripe Transfer only when the supplier is
      // Connect-active. Manual payouts (legacy bank-info path) stay
      // DUE and admin marks them paid from /ops.
      if (hasActiveStripeConnect(supplier)) {
        try {
          const transferId = await createTransferToSupplier({
            supplier,
            amountCents: transferableCents,
            orderId,
            payoutReference: payout.reference,
          });
          if (transferId) {
            await prisma.payout.update({
              where: { id: payout.id },
              data: { stripeTransferId: transferId },
            });
          }
        } catch (err) {
          captureError(err, {
            subsystem: "stripe-connect",
            op: "transfer",
            supplierId,
            orderId,
            payoutId: payout.id,
          });
          await prisma.payout.update({
            where: { id: payout.id },
            data: {
              status: "FAILED",
              failureReason: err instanceof Error ? err.message.slice(0, 500) : "Unknown",
              retryAttempts: { increment: 1 },
              lastRetryAt: new Date(),
            },
          });
          await writeAuditLog({
            actor: { id: "system", email: "system@partsport" },
            action: "PAYOUT_MARKED_PAID",
            targetType: "Payout",
            targetId: payout.id,
            summary: `Transfer FAILED on creation for ${supplier.name}: ${err instanceof Error ? err.message : "Unknown error"}`,
            metadata: {
              supplierId,
              orderId,
              transferableCents,
            },
          });
        }
      }
    } catch (err) {
      // P2002 unique race: another writer beat us, idempotent skip.
      const code = (err as { code?: string }).code;
      if (code !== "P2002") {
        captureError(err, {
          subsystem: "payouts",
          op: "ensurePayoutsForOrder",
          supplierId,
          orderId,
        });
      }
    }
  }
}

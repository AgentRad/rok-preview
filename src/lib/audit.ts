import "server-only";
import { Prisma, type User } from "@prisma/client";
import { prisma } from "./db";
import { captureError } from "./observability";

/**
 * Well-known action verbs. Free-form-string in the schema (so new actions
 * don't need a migration), but we export this set so callers can pick
 * from a typed list and TypeScript catches typos. Add to the bottom; do
 * not rename or remove (existing rows reference the values).
 */
export const AUDIT_ACTIONS = [
  "SUPPLIER_APPROVED",
  "SUPPLIER_REJECTED",
  "SUPPLIER_SUSPENDED",
  "SUPPLIER_UPDATED",
  "SUPPLIER_VISIBILITY_FLIPPED",
  "SUPPLIER_DOC_APPROVED",
  "SUPPLIER_DOC_REJECTED",
  "SUPPLIER_DOC_PENDING",
  "SUPPLIER_BANK_INFO_UPDATED",
  "TAX_EXEMPT_APPROVED",
  "TAX_EXEMPT_REJECTED",
  "TAX_EXEMPT_PENDING",
  "PAYOUT_MARKED_PAID",
  "ORDER_REFUNDED",
  "ORDER_REFUND_FAILED",
  "LABEL_PURCHASED",
  "SUPPLIER_CREATED",
  "RECONCILIATION_MISMATCH",
  "RETURN_APPROVED",
  "RETURN_REJECTED",
  "RETURN_RESOLVED",
  "ACCOUNT_IMPERSONATION_STARTED",
  "ACCOUNT_IMPERSONATION_STOPPED",
  // Refund shortfall could not be drawn from the supplier's reserve, so
  // it landed on Supplier.owedToPlatformCents. Paired with OWED_RECOVERED
  // when the next payout nets it back down.
  "OWED_INCURRED",
  "OWED_RECOVERED",
  // Polish 12 L4: dedicated action for a failed Connect transfer in
  // ensurePayoutsForOrder / payout-retry. Replaces the misleading
  // PAYOUT_MARKED_PAID + "Transfer FAILED" summary the pre-fix code
  // wrote when the transfer never landed.
  "PAYOUT_TRANSFER_FAILED",
  // Polish 12 M3: quote lifecycle audit trail.
  "QUOTE_SUBMITTED",
  "QUOTE_PRICED",
  "QUOTE_DECLINED",
  "QUOTE_ACCEPTED",
  "QUOTE_EXPIRED",
  // PLH-1 commit 2: account lifecycle.
  "USER_DELETED_UNVERIFIED",
  "USER_ANONYMIZED",
  "TWO_FACTOR_DISABLED",
  // PLH-1 commit 3: who pulled a supplier's legal document and when.
  "SUPPLIER_DOC_VIEWED",
  // PLH-1 commit 4: Stripe Connect went from active to disabled; admin
  // is alerted via attention feed + supplier may be auto-hidden.
  "SUPPLIER_CONNECT_DISABLED",
  // PLH-2 Phase 2: supplier asked the AI assistant a question.
  "SUPPLIER_AI_ASKED",
  // PLH-2 Phase 4d (D4): who streamed a buyer's tax-exempt certificate
  // (private blob, owner or admin only).
  "TAX_EXEMPT_DOC_VIEWED",
  // PLH-2 Phase 4e (E2): the auto-deliver cron flipped the order to
  // FULFILLED but sendOrderDelivered threw. The status change stands;
  // this row is the trail so admin can manually re-notify the buyer.
  "AUTO_DELIVER_EMAIL_FAILED",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditTargetType =
  | "Supplier"
  | "SupplierDocument"
  | "SupplierApplication"
  | "User"
  | "Order"
  | "Payout"
  | "ReturnRequest"
  | "Address"
  | "QuoteRequest";

/**
 * Persist an audit log row. Best-effort: failures are reported to Sentry
 * but never thrown back to the caller, so a logging hiccup can't fail an
 * otherwise-good admin mutation. (The right tradeoff for a marketplace
 * where the action mattering more than the log is the norm; if we ever
 * need stricter compliance, swap this to throw.)
 */
export async function writeAuditLog(args: {
  actor: Pick<User, "id" | "email">;
  action: AuditAction | string;
  targetType: AuditTargetType | string;
  targetId: string;
  summary: string;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: args.actor.id,
        actorEmail: args.actor.email,
        action: args.action,
        targetType: args.targetType,
        targetId: args.targetId,
        summary: args.summary.slice(0, 500),
        metadata: (args.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    });
  } catch (err) {
    captureError(err, { subsystem: "audit", action: args.action });
  }
}

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

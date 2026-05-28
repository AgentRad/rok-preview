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
  // PLH-3b F3: inbound reply rejected because the thread is in a terminal
  // state (order REFUNDED/CANCELLED, quote DECLINED/EXPIRED/ACCEPTED).
  "INBOUND_REPLY_REJECTED",
  // PLH-3b F4: an inbound fan-out email failed for a specific recipient;
  // the rest of the loop continues, this row preserves the trail.
  "INBOUND_FAN_OUT_FAILED",
  // PLH-3p F1: inbound fan-out completed for a thread; metadata carries
  // recipient count + threadKind/threadId for the post-fanout trail.
  "INBOUND_FAN_OUT_OK",
  // PLH-3c F3: admin approved or rejected a MANUFACTURER's brand claim.
  // Approval writes User.manufacturerName; rejection stores a reason.
  "OEM_APPLICATION_APPROVED",
  "OEM_APPLICATION_REJECTED",
  // PLH-3f: conversational AI catalog import. IMPORT_AI_ASKED records the
  // chat turns (hash only, no raw text). CATALOG_IMPORT_COMMITTED records
  // the final Import-all click with row counts and mapping/filter hashes.
  "IMPORT_AI_ASKED",
  "CATALOG_IMPORT_COMMITTED",
  // PLH-3h P2: supplier image manager. Every mutation on ProductImage is
  // logged so a future audit can reconstruct the gallery state per product.
  "IMAGE_UPLOADED",
  "IMAGE_DELETED",
  "IMAGES_REORDERED",
  "IMAGE_SET_PRIMARY",
  "IMAGE_ALT_UPDATED",
  // PLH-3h P5: orphan blob sweep cron deletes Vercel Blob assets under
  // products/ that no ProductImage row references and that are older than
  // the 7-day grace period.
  "ORPHAN_BLOB_DELETED",
  // PLH-3i: QuickBooks Online integration lifecycle. CONNECTED/DISCONNECTED
  // bracket the OAuth connect/disconnect flow. TOKEN_REFRESHED is written
  // when the refresh-token grant rotates the access token. The remaining
  // three are reserved for the P2..P4 sync phases that land later.
  "QBO_CONNECTED",
  "QBO_DISCONNECTED",
  "QBO_TOKEN_REFRESHED",
  "QBO_INVOICE_SYNCED",
  "QBO_REFUND_SYNCED",
  "QBO_SYNC_FAILED",
  // PLH-3i P5: admin "Run reconcile now" button at
  // /admin/integrations/quickbooks invoked the reconcile helper.
  "QBO_RECONCILE_RAN",
  // PLH-3j P2: buyer soft-deleted an address. The row remains in the
  // table so historical Order ship-to denorm survives, but the buyer's
  // address-book reads filter it out.
  "ADDRESS_SOFT_DELETED",
  // PLH-3j P4: tax-exempt cert expiry reminder cron sent an email.
  "TAX_EXEMPT_EXPIRY_NOTICE",
  // PLH-3p F2: a file was attached to a thread Message (UI upload).
  "MESSAGE_ATTACHMENT_UPLOADED",
  // PLH-3p F2: an inbound Resend email attachment could not be fetched,
  // was oversized, or had an unsupported MIME. The message still posts.
  "INBOUND_ATTACHMENT_FAILED",
  // PLH-3q: cross-role direct message thread created.
  "DM_THREAD_CREATED",
  // PLH-3q: one or more participants added to a direct message thread.
  "DM_PARTICIPANT_ADDED",
  // PLH-3s: targeted AI actions (draft invoice from an order, summarize the
  // calling supplier's open RFQs, draft a supplier reply to an RFQ).
  "AI_DRAFT_INVOICE",
  "AI_SUMMARIZE_RFQS",
  "AI_DRAFT_RFQ_REPLY",
  // PLH-3v: admin edited an order's purchaseOrderNumber. Metadata
  // carries before/after values for investigators.
  "ORDER_PO_UPDATED",
  // PLH-3w P1: admin suspended or lifted suspension on a user account.
  // Suspension also bumps sessionsValidFrom + cascades (supplier hidden,
  // products unpublished). Metadata carries the reason.
  "USER_SUSPENDED",
  "USER_UNSUSPENDED",
  // PLH-3w P1: admin banned a user. Terminal: status BANNED + email added
  // to BannedEmail so re-signup is refused.
  "USER_BANNED",
  // PLH-3w P2: admin granted a 1-hour "2FA recovery in progress" override,
  // suppressing the enforcement interstitial so the user can re-enroll.
  // Heavily audited since it is a security-control bypass.
  "USER_2FA_ADMIN_OVERRIDE",
  // PLH-3w P3: a user reported a message for abuse.
  "MESSAGE_REPORTED",
  // PLH-3w P3: an admin dismissed a reported message (no action against
  // the sender).
  "MESSAGE_REPORT_DISMISSED",
  // PLH-3y-1: buyer organization foundation lifecycle.
  "BUYER_ORG_CREATED",
  "BUYER_ORG_MEMBER_ADDED",
  "BUYER_ORG_MEMBER_REMOVED",
  "BUYER_ORG_INVITE_SENT",
  "BUYER_ORG_INVITE_ACCEPTED",
  // PLH-3y-2: org shared resources + billing.
  "BUYER_ORG_ADDRESS_ADDED",
  "BUYER_ORG_ADDRESS_REMOVED",
  "BUYER_ORG_BILLING_MODE_CHANGED",
  "BUYER_ORG_STRIPE_CUSTOMER_CREATED",
  "BUYER_ORG_TAX_EXEMPT_UPDATED",
  "BUYER_ORG_ORDERS_EXPORTED",
  // PLH-3y-3: domain auto-join + DNS verification.
  "BUYER_ORG_DOMAIN_CLAIMED",
  "BUYER_ORG_DOMAIN_VERIFIED",
  "BUYER_ORG_DOMAIN_FAILED",
  "BUYER_ORG_DOMAIN_REMOVED",
  "BUYER_ORG_DOMAIN_AUTOJOIN_UPDATED",
  "BUYER_ORG_DOMAIN_AUTOJOINED",
  // PLH-3y-4: SSO management-plane + login events. The high-volume per-login
  // outcome lives in SsoLoginEvent; these AuditLog rows cover config edits,
  // cert rotation, JIT provisioning, and the break-glass password path.
  "SSO_INITIATED",
  "SSO_LOGIN_SUCCESS",
  "SSO_LOGIN_FAILED",
  "SSO_PROVISIONED",
  "SSO_CONFIG_UPDATED",
  "SSO_CONFIG_REMOVED",
  "SSO_CERT_ROTATED",
  "EMERGENCY_PASSWORD_LOGIN",
  // PLH-3y-5: OIDC + SCIM + cert rotation + SLO.
  // SCIM provisioning lifecycle (SsoLoginEvent stays SAML-only; these are
  // management-plane rows in AuditLog).
  "SSO_DEPROVISIONED",
  "SCIM_USER_PROVISIONED",
  "SCIM_USER_UPDATED",
  "SCIM_TOKEN_ROTATED",
  // Cert rotation flow: an org staged a next signing cert, then activated it
  // (promoting next to current). Distinct from SSO_CERT_ROTATED which the
  // config save path stamps when the current cert string changes directly.
  "SSO_CERT_STAGED",
  "SSO_CERT_ACTIVATED",
  // SLO: a session was destroyed via the single-logout endpoint.
  "SSO_LOGOUT",
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
  | "QuoteRequest"
  | "ManufacturerApplication"
  | "Product"
  | "ProductImage"
  | "IntegrationCredential"
  | "DirectMessageThread"
  | "Message"
  | "BuyerOrg"
  | "SsoConfig";

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

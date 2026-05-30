// Pure authorization-decision helpers for two state-mutating routes that an
// audit found wide open:
//
//   1. POST /api/orders/[id]/pay   (demo-pay: marks an order PAID for free)
//   2. PATCH /api/quotes/[id]       (decline branch: declines an RFQ)
//
// These functions take plain primitives (no Prisma, no next/headers, no
// server-only import) so they can be unit-tested directly with the Node 24
// built-in test runner, the same zero-dependency pattern used by
// strip-quoted-reply.ts. The route handlers gather the data (session user,
// order/quote row, org status) and map a non-ok result to a NextResponse.

import crypto from "node:crypto";

export type GuardResult =
  | { ok: true }
  | { ok: false; status: number; error: string; code?: string };

const SUSPENDED_ACCOUNT_ERROR =
  "This account is not available. Contact support@partsport.com.";
const ORG_SUSPENDED_ERROR =
  "Your organization's account is suspended for a past-due balance. Contact your accounts-payable team or support@partsport.agentgaming.gg to clear it.";

// BUG 1 (CRITICAL). The demo-pay route settled any order to PAID for free with
// no auth, no ownership, no status check, and no payments-configured gate. This
// rebuilds the same guards /api/payments/create-session enforces:
//   - inert in production (503 when a real provider is configured)
//   - authenticated + ACTIVE session
//   - caller owns the order or is a platform ADMIN
//   - order is still PENDING
//   - approval queue / org-suspension gates mirrored
export function demoPayGuard(input: {
  paymentsConfigured: boolean;
  user: { id: string; role: string; status: string } | null;
  order: { buyerId: string | null; status: string; approvalStatus: string } | null;
  orgStatus: string | null;
}): GuardResult {
  // 1. Inert once a real payment provider is live. Demo-pay must never settle
  //    money in production; only Stripe Checkout may.
  if (input.paymentsConfigured) {
    return {
      ok: false,
      status: 503,
      error: "Demo checkout is disabled on this environment. Use the live payment flow.",
    };
  }
  if (!input.order) {
    return { ok: false, status: 404, error: "Order not found." };
  }
  // 2. Guest checkout is supported: POST /api/orders sets buyerId null for a
  //    guest, and the on-site demo lets a guest place and pay an order. Allow a
  //    GUEST order (buyerId null) to be demo-paid without a session, mirroring
  //    create-session's guest tolerance. Safe here because this route is
  //    demo-only (the 503 above makes it inert the moment a real provider is
  //    live), so no real money or supplier payout ever moves on this path. A
  //    real user's order (buyerId set) still requires an authenticated ACTIVE
  //    owner-or-admin session.
  const isGuestOrder = input.order.buyerId === null;
  if (!isGuestOrder) {
    if (!input.user) {
      return { ok: false, status: 401, error: "Sign in to complete checkout." };
    }
    if (input.user.status !== "ACTIVE") {
      return { ok: false, status: 403, error: SUSPENDED_ACCOUNT_ERROR };
    }
    const isOwner = input.order.buyerId === input.user.id;
    if (!isOwner && input.user.role !== "ADMIN") {
      return { ok: false, status: 403, error: "You are not allowed to pay this order." };
    }
  }
  // 3. Only a PENDING order can be paid.
  if (input.order.status !== "PENDING") {
    return { ok: false, status: 400, error: "This order is not awaiting payment." };
  }
  // 4. Mirror create-session's approval + org-suspension gates so demo-pay
  //    cannot bypass them.
  if (input.order.approvalStatus === "PENDING") {
    return {
      ok: false,
      status: 400,
      error: "This order is awaiting approval before payment can proceed.",
      code: "APPROVAL_PENDING",
    };
  }
  if (input.order.approvalStatus === "REJECTED") {
    return {
      ok: false,
      status: 400,
      error: "This order was not approved.",
      code: "APPROVAL_REJECTED",
    };
  }
  if (input.orgStatus === "SUSPENDED") {
    return { ok: false, status: 423, error: ORG_SUSPENDED_ERROR, code: "ORG_SUSPENDED" };
  }
  return { ok: true };
}

// BUG 2 (HIGH). The quote decline branch mutated the quote to DECLINED and
// emailed the buyer with NO authorization (getCurrentUser was only read for the
// audit actor with a "|| system" fallback). Require an authenticated user who
// is the quote owner, a platform ADMIN, or has access to the product's
// supplier. Mirrors the auth style of the sibling "quote" action.
export function quoteDeclineGuard(input: {
  user: { id: string; role: string } | null;
  quote: { buyerId: string | null };
  // Supplier-team context of the caller when they are a SUPPLIER member with
  // access to this product's supplier; null otherwise. roleCanRespond is
  // canRespondToQuotes(access.role) and supplierActive is
  // (supplier.status === "APPROVED" && supplier.publicVisible), both computed
  // by the route from the server-only supplier-access helpers (which cannot be
  // imported here without pulling in server-only). This keeps the guard pure +
  // unit-testable while mirroring the sibling "quote" (price) action's gate.
  supplierAccess: { roleCanRespond: boolean; supplierActive: boolean } | null;
}): GuardResult {
  if (!input.user) {
    return { ok: false, status: 401, error: "Not authorized." };
  }
  // The quote OWNER and platform ADMIN may always decline (a buyer declining
  // their own RFQ, an admin moderating), regardless of supplier role/status.
  const isOwner = !!input.quote.buyerId && input.quote.buyerId === input.user.id;
  if (isOwner || input.user.role === "ADMIN") {
    return { ok: true };
  }
  // BUG 3 fix. A supplier-team member may decline an RFQ only under the SAME
  // gate the "quote" (price) action enforces: a role that canRespondToQuotes
  // AND a supplier that is APPROVED && publicVisible (the PLH-3e B2
  // suspended-supplier gate). Previously any member with supplier access could
  // decline, including VIEWER/FINANCE/FULFILLMENT roles and members of a
  // suspended / non-public supplier, though they could not price the same RFQ.
  if (input.supplierAccess) {
    if (!input.supplierAccess.roleCanRespond) {
      return { ok: false, status: 403, error: "Your role doesn't allow responding to RFQs." };
    }
    if (!input.supplierAccess.supplierActive) {
      return {
        ok: false,
        status: 403,
        error: "Your supplier account is not active. Contact support to reactivate.",
      };
    }
    return { ok: true };
  }
  return { ok: false, status: 403, error: "Not authorized." };
}

// BUG (CRITICAL): pre-2FA "ticket" accepted as a real session cookie.
// /api/auth/login mints a JWT with kind:"2fa-pending" (signed, before the TOTP
// step) and returns it to the client. getCurrentUser only read payload.uid, so
// an attacker with just the password could set that ticket as the pp_session
// cookie and be fully authenticated WITHOUT the second factor. A REAL session
// JWT minted by createSession carries no kind claim (only uid/svf, plus
// optional sso/org); reject any verified token that carries a kind. Pure
// predicate so it is unit-testable without server-only/jose. (Defense in depth:
// the ticket is also signed with a domain-separated secret, see getTicketSecret
// in auth.ts, so a kind-less mistake still cannot cross over.)
export function isSessionTokenPayload(payload: Record<string, unknown>): boolean {
  return payload.kind === undefined || payload.kind === null;
}

// BUG (CRITICAL): SSO config trusted a domain allowlist + enforce flag with no
// cross-check against the DNS-TXT-verified BuyerOrgDomain table. An org admin
// could PUT domainAllowlist:["victim-corp.com"], enforced:true for a domain the
// org never proved control of, then every victim-corp.com password login 403s
// with an ssoInitiateUrl pointing at the attacker's IdP (lockout + phishing),
// and SAML/OIDC JIT provisioning trusts the same unverified allowlist. The
// domain auto-join feature (PLH-3y-3) correctly requires a VERIFIED row; SSO
// skipped it. This pure function (allowlist + the org's set of VERIFIED domains
// + enforce flag -> ok/error) is the gate; the upsert path queries the verified
// rows and turns a non-ok result into a 400. Comparison is case-insensitive
// (both sides come through normalizeDomainClaim, which lowercases, but the set
// is defensive).
export function validateSsoDomainTrust(input: {
  allowlist: string[];
  verifiedDomains: string[];
  enforced: boolean;
}): { ok: true } | { ok: false; error: string } {
  const verified = new Set(input.verifiedDomains.map((d) => d.toLowerCase()));
  const unverified = input.allowlist.filter((d) => !verified.has(d.toLowerCase()));
  if (unverified.length > 0) {
    const plural = unverified.length > 1;
    return {
      ok: false,
      error: `Cannot trust ${plural ? "domains" : "domain"} not verified for this organization: ${unverified.join(
        ", "
      )}. Verify ${plural ? "them" : "it"} under the organization's Email domains card first.`,
    };
  }
  // enforced=true means every password login on an allowlisted domain is forced
  // to SSO, so you must have proven control of at least one domain first. Since
  // every allowlist entry above is already verified, a non-empty allowlist
  // guarantees at least one verified domain.
  if (input.enforced && input.allowlist.length === 0) {
    return {
      ok: false,
      error:
        "Cannot enforce SSO without at least one verified domain in the allowlist. Verify a domain under the organization's Email domains card first.",
    };
  }
  return { ok: true };
}

// BUG (HIGH): no separation of duties on approvals. advanceApproval authorized a
// decider on isAdmin || assigned-approver, with no check that the decider is not
// the member who PLACED the order. A buyer who also holds APPROVER (and is the
// assigned approver), or an org ADMIN, could approve an order they placed,
// voiding the spend control. This gate rejects self-APPROVAL only: rejecting
// one's own order (a buyer cancelling their own request) stays allowed, and the
// admin short-circuit must not bypass it. Pure logic so it is unit-testable.
export function canDecideApproval(input: {
  deciderMemberId: string;
  placingMemberId: string | null;
  isAdmin: boolean;
  decision: "APPROVE" | "REJECT";
}): GuardResult {
  // Rejecting your own order is fine. Only block self-approval.
  if (input.decision === "REJECT") return { ok: true };
  // Separation of duties: the placing member may never approve their own order,
  // not even as an org ADMIN (the short-circuit must honor this too).
  if (input.placingMemberId && input.deciderMemberId === input.placingMemberId) {
    return { ok: false, status: 400, error: "You cannot approve your own order." };
  }
  return { ok: true };
}

// BUG (HIGH): OOO delegation could hand approval power to a role that cannot
// approve (e.g. a VIEWER), because the ooo route did no role check on the
// delegate and advanceApproval authorizes purely on being assigned. The route
// computes whether the delegate can approve via the canonical
// canApproveOrders(role) helper and passes the boolean here, so the role set
// stays single-sourced in buyer-org-access.ts and this gate stays pure +
// testable.
// QA-re-audit (single-source approver role gate): a member acting as the
// assigned approver in advanceApproval must hold a role that can actually
// approve orders. The caller computes canApproveOrders(role) and passes the
// boolean, so the role set stays single-sourced in buyer-org-access.ts and this
// gate stays pure + testable (same pattern as delegateApprovalGuard). Applies to
// both APPROVE and REJECT: a non-approver role has no authority either way.
export function approverRoleGuard(input: { roleCanApprove: boolean }): GuardResult {
  if (!input.roleCanApprove) {
    return {
      ok: false,
      status: 400,
      error: "Your organization role cannot approve or reject orders.",
    };
  }
  return { ok: true };
}

export function delegateApprovalGuard(input: { delegateCanApprove: boolean }): GuardResult {
  if (!input.delegateCanApprove) {
    return {
      ok: false,
      status: 400,
      error: "The delegate must be able to approve orders (an APPROVER or ADMIN of this organization).",
    };
  }
  return { ok: true };
}

// QA2 BUG 1. Manual invoice-payment: does the running total clear the invoice?
// An invoice clears only when the cumulative paid cents reach or exceed the
// total. Used by POST /api/admin/invoices/[id]/payments AFTER the increment
// is applied inside the transaction (compute against the fresh post-increment
// partialPaidCents, never the stale pre-read value).
export function clearsInvoice(partialPaidCents: number, totalCents: number): boolean {
  return partialPaidCents >= totalCents;
}

// QA2 BUG 2. Refund over-refund cap. Given the order total and the amount
// already refunded (re-read FRESH inside the refund transaction), how many
// cents remain refundable, and is a requested amount within the cap?
// Negative inputs are clamped to 0 so a corrupt row can never widen the cap.
export function refundRemainingCents(
  totalCents: number,
  alreadyRefundedCents: number
): number {
  return Math.max(0, totalCents - Math.max(0, alreadyRefundedCents));
}

export function refundWithinCap(
  totalCents: number,
  alreadyRefundedCents: number,
  requestedCents: number
): boolean {
  return (
    requestedCents > 0 &&
    requestedCents <= refundRemainingCents(totalCents, alreadyRefundedCents)
  );
}

// QA2 auth/SSO BUG 1. OIDC login-CSRF binding. The signed `state` only proves
// the IdP round-trip is intact; it does NOT prove THIS browser started the
// flow. /api/auth/sso/initiate now drops a short-lived HttpOnly cookie holding
// the state nonce, and the OIDC callback requires that cookie to be present and
// to equal the nonce inside the signed state. A missing or mismatched cookie
// means the callback URL was fed to a victim's browser (classic OIDC login CSRF
// / session fixation) and no session is minted. Both must be non-empty and
// equal; the nonce already rides inside a signed JWT so a plain compare is
// sufficient (this is a presence/binding check, not a secrecy check).
export function stateNonceMatches(
  cookieNonce: string | null | undefined,
  stateNonce: string | null | undefined
): boolean {
  if (!cookieNonce || !stateNonce) return false;
  return cookieNonce === stateNonce;
}

// QA2 auth/SSO BUG 3. TOTP replay within the validation window. verifyTotp uses
// window:1, so a single 6-digit code is valid for ~90s (current step +/- 1).
// With no record of the last consumed step the same code could be replayed to
// mint a second session. The login path persists the last accepted 30-second
// step on the User and rejects any candidate step at or below it. A null
// lastStep (never logged in with 2FA before, or pre-migration) is never a
// replay. Pure so it is unit-testable without otpauth or a DB.
//
// QA3-fix analysis (the "fast device clock false-reject" candidate): the `<=`
// comparison is CORRECT and does NOT false-reject a legitimate next code. Two
// facts make this airtight: (1) verifyTotpStep returns the code's CANONICAL
// absolute step (server-current step + the matching window delta), so the
// returned value identifies the code itself, independent of how fast/slow the
// presenting device's clock runs; (2) each 30-second step has exactly one
// 6-digit HOTP code. Therefore two presentations collide on a single stored
// step ONLY when they are the literally-same code, which is precisely the reuse
// we must block. A device with a fast clock does not break this: at the next
// real step it displays the NEXT step's code (a strictly greater canonical
// step), which passes. The spec's worry assumed a fast-clock device would
// re-show the same step's code at the next real window; it cannot, because an
// authenticator advances monotonically with wall-clock time. The only way to
// present a candidateStep <= lastStep is to re-show an already-consumed (or
// older) code, so rejecting it is genuine anti-replay, not a false-reject. No
// behavioral change; the clear "wait for the next code" 401 message on the
// login path already gives the right UX when a user double-submits within one
// 30s window.
export function totpStepIsReplay(
  candidateStep: number,
  lastStep: number | null | undefined
): boolean {
  if (lastStep === null || lastStep === undefined) return false;
  return candidateStep <= lastStep;
}

// QA2 BUG 3. Stripe transfer idempotency key. Each LOGICAL transfer for a
// supplier+order must own a distinct key so Stripe does not return a cached
// earlier transfer in place of a new one. The original payout and the
// held-back 5% reserve release are two different logical transfers for the
// same supplier+order, so they must carry different `kind` discriminators.
// The key is stable across retries of the SAME logical transfer (same kind +
// supplier + order) so a retry dedupes at Stripe instead of double-sending.
export function buildTransferIdempotencyKey(
  kind: string,
  supplierId: string,
  orderId: string
): string {
  return `${kind}_${supplierId}_${orderId}`;
}

// QA2 acting-as BUG 2. The pp_acting_as cookie stored a raw supplierId,
// unsigned and not bound to the admin who set it. It is only HONORED for
// ADMIN sessions, so a non-admin cannot forge powers, but a value set under
// one admin session was honored under any admin session (defense-in-depth
// weak). The cookie is now `${supplierId}.${sig}` where sig is HMAC-SHA256
// over `${supplierId}.${adminUserId}` truncated to 16 bytes (32 hex chars),
// so the reader can prove BOTH integrity and that the binding admin matches
// the current session. supplierId is a cuid (no dots) so the last "." cleanly
// separates payload from signature. Pure (secret passed in) so the
// sign/verify round-trip is unit-testable without next/headers.
export function signActingAsToken(
  supplierId: string,
  adminUserId: string,
  secret: string
): string {
  const mac = crypto
    .createHmac("sha256", secret)
    .update(`${supplierId}.${adminUserId}`)
    .digest();
  return mac.subarray(0, 16).toString("hex");
}

/** Build the signed cookie value written by setActingAsSupplier. */
export function buildActingAsCookie(
  supplierId: string,
  adminUserId: string,
  secret: string
): string {
  return `${supplierId}.${signActingAsToken(supplierId, adminUserId, secret)}`;
}

/**
 * Verify a pp_acting_as cookie value against the CURRENT admin's user id.
 * Returns the impersonated supplierId on a valid signature whose binding
 * admin matches `adminUserId`, else null (fall back to no impersonation).
 * Constant-time signature compare.
 */
export function verifyActingAsCookie(
  value: string | null | undefined,
  adminUserId: string,
  secret: string
): string | null {
  if (!value || typeof value !== "string") return null;
  const idx = value.lastIndexOf(".");
  if (idx <= 0 || idx >= value.length - 1) return null;
  const supplierId = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  if (!supplierId || sig.length !== 32) return null;
  const expected = signActingAsToken(supplierId, adminUserId, secret);
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(expected, "hex");
    b = Buffer.from(sig, "hex");
  } catch {
    return null;
  }
  if (a.length !== b.length || a.length !== 16) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return supplierId;
}

// QA2 acting-as BUG 3. The bank last-4 in audit metadata was a bare
// sha256(last4).slice(0,8). last4 has only 10,000 possible values, so anyone
// with audit-log read access can precompute the full table and recover the
// digits, defeating the PLH-3e B7 intent. HMAC with a server secret instead:
// the before/after hash mismatch still signals "the payout destination
// changed" while the value is no longer reversible without the secret. Pure
// (secret passed in) so stability + uniqueness is unit-testable.
export function hmacLast4(
  last4: string | null | undefined,
  secret: string
): string | null {
  if (!last4) return null;
  return crypto.createHmac("sha256", secret).update(last4).digest("hex").slice(0, 8);
}

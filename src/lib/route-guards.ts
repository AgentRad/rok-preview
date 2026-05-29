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
  // 2. Require an authenticated, ACTIVE session.
  if (!input.user) {
    return { ok: false, status: 401, error: "Sign in to complete checkout." };
  }
  if (input.user.status !== "ACTIVE") {
    return { ok: false, status: 403, error: SUSPENDED_ACCOUNT_ERROR };
  }
  if (!input.order) {
    return { ok: false, status: 404, error: "Order not found." };
  }
  // 2 (cont). Must own the order or be a platform admin.
  const isOwner = !!input.order.buyerId && input.order.buyerId === input.user.id;
  if (!isOwner && input.user.role !== "ADMIN") {
    return { ok: false, status: 403, error: "You are not allowed to pay this order." };
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
  supplierAccessOk: boolean;
}): GuardResult {
  if (!input.user) {
    return { ok: false, status: 401, error: "Not authorized." };
  }
  const isOwner = !!input.quote.buyerId && input.quote.buyerId === input.user.id;
  if (isOwner || input.user.role === "ADMIN" || input.supplierAccessOk) {
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

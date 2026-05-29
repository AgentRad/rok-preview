// Standalone unit tests for the demo-pay and quote-decline authorization
// guards (the two missing-authorization bugs an audit found).
// Run: node --experimental-strip-types --test scripts/test-route-guards.mjs
// This repo has no vitest/jest installed (see PLH-3d note). Node 24's built-in
// test runner + native TS strip-types exercises the pure decision functions
// without standing up a DB or the Next runtime, the same pattern as
// test-strip-quoted-reply.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  demoPayGuard,
  quoteDeclineGuard,
  isSessionTokenPayload,
  validateSsoDomainTrust,
  canDecideApproval,
  delegateApprovalGuard,
  approverRoleGuard,
  clearsInvoice,
  refundRemainingCents,
  refundWithinCap,
  buildTransferIdempotencyKey,
  stateNonceMatches,
  totpStepIsReplay,
  signActingAsToken,
  buildActingAsCookie,
  verifyActingAsCookie,
  hmacLast4,
} from "../src/lib/route-guards.ts";

const OWNER = { id: "u_owner", role: "BUYER", status: "ACTIVE" };
const ADMIN = { id: "u_admin", role: "ADMIN", status: "ACTIVE" };
const OTHER = { id: "u_other", role: "BUYER", status: "ACTIVE" };
const PENDING_ORDER = {
  buyerId: "u_owner",
  status: "PENDING",
  approvalStatus: "NONE",
};

// ---- BUG 1: demo-pay ----

test("demo-pay: 503 when payments ARE configured (inert in production)", () => {
  const r = demoPayGuard({
    paymentsConfigured: true,
    user: OWNER,
    order: PENDING_ORDER,
    orgStatus: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
});

test("demo-pay: 401 for an unauthenticated caller", () => {
  const r = demoPayGuard({
    paymentsConfigured: false,
    user: null,
    order: PENDING_ORDER,
    orgStatus: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test("demo-pay: 403 for a signed-in non-owner, non-admin", () => {
  const r = demoPayGuard({
    paymentsConfigured: false,
    user: OTHER,
    order: PENDING_ORDER,
    orgStatus: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("demo-pay: 403 for a suspended account", () => {
  const r = demoPayGuard({
    paymentsConfigured: false,
    user: { ...OWNER, status: "SUSPENDED" },
    order: PENDING_ORDER,
    orgStatus: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("demo-pay: 404 when the order does not exist", () => {
  const r = demoPayGuard({
    paymentsConfigured: false,
    user: OWNER,
    order: null,
    orgStatus: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});

test("demo-pay: 400 when the order is not PENDING", () => {
  const r = demoPayGuard({
    paymentsConfigured: false,
    user: OWNER,
    order: { ...PENDING_ORDER, status: "PAID" },
    orgStatus: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("demo-pay: blocks an order awaiting approval", () => {
  const r = demoPayGuard({
    paymentsConfigured: false,
    user: OWNER,
    order: { ...PENDING_ORDER, approvalStatus: "PENDING" },
    orgStatus: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.code, "APPROVAL_PENDING");
});

test("demo-pay: blocks a rejected order", () => {
  const r = demoPayGuard({
    paymentsConfigured: false,
    user: OWNER,
    order: { ...PENDING_ORDER, approvalStatus: "REJECTED" },
    orgStatus: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "APPROVAL_REJECTED");
});

test("demo-pay: 423 for a member of a suspended org", () => {
  const r = demoPayGuard({
    paymentsConfigured: false,
    user: OWNER,
    order: PENDING_ORDER,
    orgStatus: "SUSPENDED",
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 423);
  assert.equal(r.code, "ORG_SUSPENDED");
});

test("demo-pay: allows the owner of a clean PENDING order (demo mode)", () => {
  const r = demoPayGuard({
    paymentsConfigured: false,
    user: OWNER,
    order: PENDING_ORDER,
    orgStatus: "ACTIVE",
  });
  assert.equal(r.ok, true);
});

test("demo-pay: allows an admin on someone else's PENDING order", () => {
  const r = demoPayGuard({
    paymentsConfigured: false,
    user: ADMIN,
    order: PENDING_ORDER,
    orgStatus: null,
  });
  assert.equal(r.ok, true);
});

// ---- BUG 2: quote decline ----

const QUOTE = { buyerId: "u_owner" };

test("quote-decline: 401 for an unauthenticated caller", () => {
  const r = quoteDeclineGuard({ user: null, quote: QUOTE, supplierAccessOk: false });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test("quote-decline: 403 for a signed-in non-owner with no supplier access", () => {
  const r = quoteDeclineGuard({ user: OTHER, quote: QUOTE, supplierAccessOk: false });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("quote-decline: allows the quote owner", () => {
  const r = quoteDeclineGuard({ user: OWNER, quote: QUOTE, supplierAccessOk: false });
  assert.equal(r.ok, true);
});

test("quote-decline: allows a platform admin", () => {
  const r = quoteDeclineGuard({ user: ADMIN, quote: QUOTE, supplierAccessOk: false });
  assert.equal(r.ok, true);
});

test("quote-decline: allows the product's supplier", () => {
  const supplier = { id: "u_supplier", role: "SUPPLIER" };
  const r = quoteDeclineGuard({ user: supplier, quote: QUOTE, supplierAccessOk: true });
  assert.equal(r.ok, true);
});

test("quote-decline: 403 for a supplier WITHOUT access to this product", () => {
  const supplier = { id: "u_supplier", role: "SUPPLIER" };
  const r = quoteDeclineGuard({ user: supplier, quote: QUOTE, supplierAccessOk: false });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

// ---- BUG (CRITICAL): 2FA-pending ticket must not pass as a session token ----

test("session-token: rejects a 2fa-pending ticket payload", () => {
  assert.equal(isSessionTokenPayload({ uid: "u1", kind: "2fa-pending" }), false);
});

test("session-token: accepts a real session payload (uid, no kind)", () => {
  assert.equal(isSessionTokenPayload({ uid: "u1", svf: 123 }), true);
});

test("session-token: accepts an SSO session payload (uid/sso/org, no kind)", () => {
  assert.equal(
    isSessionTokenPayload({ uid: "u1", svf: 123, sso: true, org: "o1" }),
    true
  );
});

test("session-token: rejects any non-null kind value", () => {
  assert.equal(isSessionTokenPayload({ uid: "u1", kind: "anything" }), false);
});

// ---- BUG (CRITICAL): SSO domain-trust gate ----

test("sso-domain-trust: rejects an allowlisted domain that is not verified", () => {
  const r = validateSsoDomainTrust({
    allowlist: ["victim-corp.com"],
    verifiedDomains: [],
    enforced: false,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /victim-corp\.com/);
});

test("sso-domain-trust: rejects when one of several domains is unverified", () => {
  const r = validateSsoDomainTrust({
    allowlist: ["acme.com", "victim-corp.com"],
    verifiedDomains: ["acme.com"],
    enforced: false,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /victim-corp\.com/);
  assert.doesNotMatch(r.error, /acme\.com/);
});

test("sso-domain-trust: allows an allowlist whose domains are all verified", () => {
  const r = validateSsoDomainTrust({
    allowlist: ["acme.com"],
    verifiedDomains: ["acme.com", "acme.io"],
    enforced: false,
  });
  assert.equal(r.ok, true);
});

test("sso-domain-trust: case-insensitive verified match", () => {
  const r = validateSsoDomainTrust({
    allowlist: ["ACME.com"],
    verifiedDomains: ["acme.com"],
    enforced: false,
  });
  assert.equal(r.ok, true);
});

test("sso-domain-trust: enforce with a verified domain passes", () => {
  const r = validateSsoDomainTrust({
    allowlist: ["acme.com"],
    verifiedDomains: ["acme.com"],
    enforced: true,
  });
  assert.equal(r.ok, true);
});

test("sso-domain-trust: enforce with an empty allowlist is rejected", () => {
  const r = validateSsoDomainTrust({
    allowlist: [],
    verifiedDomains: ["acme.com"],
    enforced: true,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /enforce/i);
});

test("sso-domain-trust: cert-only save (empty allowlist, not enforced) passes", () => {
  const r = validateSsoDomainTrust({
    allowlist: [],
    verifiedDomains: [],
    enforced: false,
  });
  assert.equal(r.ok, true);
});

// ---- QA1-fix4 BUG 1: approval separation of duties ----

test("approval: the placing member cannot approve their own order", () => {
  const r = canDecideApproval({
    deciderMemberId: "m_alice",
    placingMemberId: "m_alice",
    isAdmin: false,
    decision: "APPROVE",
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /your own order/i);
});

test("approval: an org ADMIN still cannot approve their own order (short-circuit honors SoD)", () => {
  const r = canDecideApproval({
    deciderMemberId: "m_alice",
    placingMemberId: "m_alice",
    isAdmin: true,
    decision: "APPROVE",
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("approval: a different member may approve the order", () => {
  const r = canDecideApproval({
    deciderMemberId: "m_bob",
    placingMemberId: "m_alice",
    isAdmin: false,
    decision: "APPROVE",
  });
  assert.equal(r.ok, true);
});

test("approval: rejecting your own order is allowed (cancel your own request)", () => {
  const r = canDecideApproval({
    deciderMemberId: "m_alice",
    placingMemberId: "m_alice",
    isAdmin: false,
    decision: "REJECT",
  });
  assert.equal(r.ok, true);
});

test("approval: unknown placing member does not block approval", () => {
  const r = canDecideApproval({
    deciderMemberId: "m_bob",
    placingMemberId: null,
    isAdmin: false,
    decision: "APPROVE",
  });
  assert.equal(r.ok, true);
});

// ---- QA1-fix4 BUG 3: OOO delegate must be able to approve ----

test("delegate: a delegate who cannot approve (VIEWER/BUYER) is rejected", () => {
  const r = delegateApprovalGuard({ delegateCanApprove: false });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /approve orders/i);
});

test("delegate: a delegate who can approve (APPROVER/ADMIN) is allowed", () => {
  const r = delegateApprovalGuard({ delegateCanApprove: true });
  assert.equal(r.ok, true);
});

// ---- QA-re-audit: single-source approver role gate in advanceApproval ----
// The engine computes canApproveOrders(decider.role) and passes the boolean to
// approverRoleGuard (same boolean pattern as delegateApprovalGuard). This mirror
// of the canonical canApproveOrders role set lets the test drive the full
// role -> outcome chain that advanceApproval applies to BOTH approve and reject.
const roleCanApprove = (role) => role === "ADMIN" || role === "APPROVER";

test("approver-role gate: a VIEWER decider is rejected", () => {
  const r = approverRoleGuard({ roleCanApprove: roleCanApprove("VIEWER") });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /approve or reject/i);
});

test("approver-role gate: a BUYER decider is rejected", () => {
  const r = approverRoleGuard({ roleCanApprove: roleCanApprove("BUYER") });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("approver-role gate: an APPROVER member is allowed", () => {
  assert.equal(approverRoleGuard({ roleCanApprove: roleCanApprove("APPROVER") }).ok, true);
});

test("approver-role gate: an ADMIN member (the admin short-circuit) is allowed", () => {
  // A buyer-org ADMIN satisfies canApproveOrders, so the isAdmin short-circuit
  // in advanceApproval passes this gate unchanged.
  assert.equal(approverRoleGuard({ roleCanApprove: roleCanApprove("ADMIN") }).ok, true);
});

test("approver-role gate: rejection applies regardless of decision (false boolean always rejects)", () => {
  // advanceApproval calls the gate before splitting on APPROVE vs REJECT, so a
  // non-approver is blocked on both paths.
  assert.equal(approverRoleGuard({ roleCanApprove: false }).ok, false);
  assert.equal(approverRoleGuard({ roleCanApprove: true }).ok, true);
});

// ---- QA2 BUG 1: invoice clears only at full payment ----

test("invoice: a partial payment does NOT clear the invoice", () => {
  // 4000 of 10000 paid so far, plus this is the running total post-increment.
  assert.equal(clearsInvoice(4000, 10000), false);
});

test("invoice: clears exactly when the running total reaches the total", () => {
  assert.equal(clearsInvoice(10000, 10000), true);
});

test("invoice: clears when an over-payment exceeds the total", () => {
  assert.equal(clearsInvoice(10500, 10000), true);
});

test("invoice: a zero-total invoice is considered cleared at zero", () => {
  assert.equal(clearsInvoice(0, 0), true);
});

// ---- QA3 BUG 1: slot-level refund cap (fresh in-tx re-read) ----
// refundOrder now re-reads the target OrderSupplierSlot FRESH inside the
// unified refund tx and caps via refundRemainingCents on the slot base
// (subtotalCents + freightCents). These cases pin the pure slot math the
// in-tx guard relies on. Slot base here: subtotal 8000 + freight 2000 = 10000.
const slotBase = (subtotal, freight) => subtotal + freight;

test("slot-cap: refund OVER the slot remaining is rejected", () => {
  // 6000 already refunded on the slot, 4000 remains; a 4001 refund is over.
  const remaining = refundRemainingCents(slotBase(8000, 2000), 6000);
  assert.equal(remaining, 4000);
  assert.equal(refundWithinCap(slotBase(8000, 2000), 6000, 4001), false);
});

test("slot-cap: a refund for EXACTLY the slot remaining is allowed", () => {
  assert.equal(refundWithinCap(slotBase(8000, 2000), 6000, 4000), true);
});

test("slot-cap: a PARTIAL refund within the slot remaining is allowed", () => {
  assert.equal(refundWithinCap(slotBase(8000, 2000), 6000, 1000), true);
});

test("slot-cap: a fully-refunded slot has zero remaining and rejects any more", () => {
  // Two concurrent slot-scoped refunds: the first consumed the whole slot, so
  // the second, re-reading fresh in-tx, sees 0 remaining and is rejected even
  // though the ORDER may still have headroom from other slots.
  assert.equal(refundRemainingCents(slotBase(8000, 2000), 10000), 0);
  assert.equal(refundWithinCap(slotBase(8000, 2000), 10000, 1), false);
});

test("slot-cap: a corrupt over-refunded slot row cannot widen the cap below zero", () => {
  // refundedCents somehow exceeds the base: remaining clamps to 0, never negative.
  assert.equal(refundRemainingCents(slotBase(8000, 2000), 12000), 0);
});

// QA2 BUG 1 lost-update shape: two concurrent payments. The fix increments
// atomically, so the running total is the SUM, not the last writer's blind
// set. Only the cumulative sum clears the invoice.
test("invoice: two concurrent partials each below total clear only when summed", () => {
  const total = 10000;
  const first = 6000;
  const second = 6000;
  // Blind-set (buggy) behavior: second writer clobbers first -> 6000, never clears.
  assert.equal(clearsInvoice(second, total), false);
  // Atomic-increment (fixed) behavior: running total is the sum -> clears.
  assert.equal(clearsInvoice(first + second, total), true);
});

// ---- QA2 BUG 2: refund over-refund cap ----

test("refund cap: remaining is total minus already-refunded", () => {
  assert.equal(refundRemainingCents(10000, 3000), 7000);
});

test("refund cap: remaining never goes negative on a corrupt over-refunded row", () => {
  assert.equal(refundRemainingCents(10000, 12000), 0);
});

test("refund cap: a negative already-refunded is clamped to 0", () => {
  assert.equal(refundRemainingCents(10000, -500), 10000);
});

test("refund cap: rejects an over-refund (amount > remaining)", () => {
  // 8000 already refunded on a 10000 order: only 2000 remains.
  assert.equal(refundWithinCap(10000, 8000, 2001), false);
});

test("refund cap: accepts a refund up to exactly the remaining amount", () => {
  assert.equal(refundWithinCap(10000, 8000, 2000), true);
});

test("refund cap: rejects a zero or negative requested amount", () => {
  assert.equal(refundWithinCap(10000, 0, 0), false);
  assert.equal(refundWithinCap(10000, 0, -100), false);
});

// QA2 BUG 2 concurrency shape: two concurrent manualOverride refunds each pass
// the STALE pre-tx cap, but the FRESH in-tx re-read of refundedCents rejects
// the second so the order can never be over-refunded.
test("refund cap: fresh in-tx re-read rejects the second concurrent over-refund", () => {
  const total = 10000;
  const requested = 7000;
  // Both reads see refundedCents=0 (stale snapshot) -> both pass pre-tx check.
  assert.equal(refundWithinCap(total, 0, requested), true);
  // First commits: refundedCents is now 7000. Second tx re-reads fresh:
  // remaining is 3000, so 7000 is rejected.
  assert.equal(refundWithinCap(total, 7000, requested), false);
});

// ---- QA2 BUG 3: distinct Stripe transfer idempotency keys ----

test("transfer key: the payout and reserve-release keys differ for same supplier+order", () => {
  const payout = buildTransferIdempotencyKey("payout", "sup_1", "ord_1");
  const release = buildTransferIdempotencyKey("reserve_release", "sup_1", "ord_1");
  assert.notEqual(payout, release);
});

test("transfer key: the default payout key shape is unchanged (back-compat)", () => {
  assert.equal(buildTransferIdempotencyKey("payout", "sup_1", "ord_1"), "payout_sup_1_ord_1");
});

test("transfer key: stable across retries of the same logical transfer", () => {
  assert.equal(
    buildTransferIdempotencyKey("reserve_release", "sup_9", "ord_9"),
    buildTransferIdempotencyKey("reserve_release", "sup_9", "ord_9")
  );
});

test("transfer key: differs per supplier and per order", () => {
  assert.notEqual(
    buildTransferIdempotencyKey("payout", "sup_1", "ord_1"),
    buildTransferIdempotencyKey("payout", "sup_2", "ord_1")
  );
  assert.notEqual(
    buildTransferIdempotencyKey("payout", "sup_1", "ord_1"),
    buildTransferIdempotencyKey("payout", "sup_1", "ord_2")
  );
});

// ---- QA2 auth/SSO BUG 1: OIDC state cookie binding ----

test("oidc binding: matching non-empty cookie + state nonce passes", () => {
  assert.equal(stateNonceMatches("abc123", "abc123"), true);
});

test("oidc binding: mismatched nonce is rejected (login CSRF)", () => {
  assert.equal(stateNonceMatches("attacker", "victim"), false);
});

test("oidc binding: missing cookie is rejected", () => {
  assert.equal(stateNonceMatches("", "abc123"), false);
  assert.equal(stateNonceMatches(null, "abc123"), false);
  assert.equal(stateNonceMatches(undefined, "abc123"), false);
});

test("oidc binding: missing state nonce is rejected", () => {
  assert.equal(stateNonceMatches("abc123", ""), false);
  assert.equal(stateNonceMatches("abc123", null), false);
});

test("oidc binding: both empty is rejected (no accidental pass)", () => {
  assert.equal(stateNonceMatches("", ""), false);
});

// ---- QA2 auth/SSO BUG 3: TOTP replay within the validation window ----

test("totp replay: equal step is a replay (reject)", () => {
  assert.equal(totpStepIsReplay(100, 100), true);
});

test("totp replay: older step is a replay (reject)", () => {
  assert.equal(totpStepIsReplay(99, 100), true);
});

test("totp replay: newer step is not a replay (accept)", () => {
  assert.equal(totpStepIsReplay(101, 100), false);
});

test("totp replay: null lastStep (first 2FA login / pre-migration) is never a replay", () => {
  assert.equal(totpStepIsReplay(100, null), false);
  assert.equal(totpStepIsReplay(100, undefined), false);
});

// ---- QA2 acting-as BUG 2: signed admin-bound impersonation cookie ----

const ACT_SECRET = "test-acting-as-secret-at-least-32-chars-long";
const SUP = "cmpokkr5y0003l704715ph61l"; // cuid shape, no dots
const ADMIN_A = "u_admin_a";
const ADMIN_B = "u_admin_b";

test("acting-as: a cookie signed for an admin verifies back to the supplierId for THAT admin", () => {
  const cookie = buildActingAsCookie(SUP, ADMIN_A, ACT_SECRET);
  assert.equal(verifyActingAsCookie(cookie, ADMIN_A, ACT_SECRET), SUP);
});

test("acting-as: a cookie set under one admin is NOT honored under a different admin", () => {
  const cookie = buildActingAsCookie(SUP, ADMIN_A, ACT_SECRET);
  assert.equal(verifyActingAsCookie(cookie, ADMIN_B, ACT_SECRET), null);
});

test("acting-as: a tampered supplierId (signature no longer matches) is rejected", () => {
  const cookie = buildActingAsCookie(SUP, ADMIN_A, ACT_SECRET);
  const sig = cookie.slice(cookie.lastIndexOf(".") + 1);
  const tampered = `cmEVILsupplierid000000000.${sig}`;
  assert.equal(verifyActingAsCookie(tampered, ADMIN_A, ACT_SECRET), null);
});

test("acting-as: a tampered signature is rejected", () => {
  const cookie = buildActingAsCookie(SUP, ADMIN_A, ACT_SECRET);
  const tampered = cookie.slice(0, cookie.lastIndexOf(".") + 1) + "00000000000000000000000000000000";
  assert.equal(verifyActingAsCookie(tampered, ADMIN_A, ACT_SECRET), null);
});

test("acting-as: an unsigned legacy raw-supplierId value is rejected (no dot/sig)", () => {
  assert.equal(verifyActingAsCookie(SUP, ADMIN_A, ACT_SECRET), null);
});

test("acting-as: null / empty / malformed cookie values are rejected", () => {
  assert.equal(verifyActingAsCookie(null, ADMIN_A, ACT_SECRET), null);
  assert.equal(verifyActingAsCookie("", ADMIN_A, ACT_SECRET), null);
  assert.equal(verifyActingAsCookie(".abcd", ADMIN_A, ACT_SECRET), null);
  assert.equal(verifyActingAsCookie(`${SUP}.`, ADMIN_A, ACT_SECRET), null);
});

test("acting-as: a value signed with a different secret is rejected", () => {
  const cookie = buildActingAsCookie(SUP, ADMIN_A, ACT_SECRET);
  assert.equal(verifyActingAsCookie(cookie, ADMIN_A, "some-other-secret-value-32-characters!!"), null);
});

test("acting-as: signActingAsToken is a 32-hex-char HMAC truncation", () => {
  const sig = signActingAsToken(SUP, ADMIN_A, ACT_SECRET);
  assert.equal(sig.length, 32);
  assert.match(sig, /^[0-9a-f]{32}$/);
});

// ---- QA2 acting-as BUG 3: HMAC last4 fingerprint ----

const HASH_SECRET = "test-bank-info-hash-secret-32-chars-min";

test("hmacLast4: stable for the same input + secret (change-detection compares equal)", () => {
  assert.equal(hmacLast4("1234", HASH_SECRET), hmacLast4("1234", HASH_SECRET));
});

test("hmacLast4: differs across different last4 (a change still signals a change)", () => {
  assert.notEqual(hmacLast4("1234", HASH_SECRET), hmacLast4("5678", HASH_SECRET));
});

test("hmacLast4: differs across secrets (not reversible without the server secret)", () => {
  assert.notEqual(hmacLast4("1234", HASH_SECRET), hmacLast4("1234", "a-completely-different-secret-value!!"));
});

test("hmacLast4: returns a short hex slice, not the raw digits", () => {
  const h = hmacLast4("1234", HASH_SECRET);
  assert.equal(h.length, 8);
  assert.match(h, /^[0-9a-f]{8}$/);
  assert.notEqual(h, "1234");
});

test("hmacLast4: null / empty input returns null", () => {
  assert.equal(hmacLast4(null, HASH_SECRET), null);
  assert.equal(hmacLast4(undefined, HASH_SECRET), null);
  assert.equal(hmacLast4("", HASH_SECRET), null);
});

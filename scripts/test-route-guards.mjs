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

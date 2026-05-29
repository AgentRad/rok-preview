// Standalone unit tests for the demo-pay and quote-decline authorization
// guards (the two missing-authorization bugs an audit found).
// Run: node --experimental-strip-types --test scripts/test-route-guards.mjs
// This repo has no vitest/jest installed (see PLH-3d note). Node 24's built-in
// test runner + native TS strip-types exercises the pure decision functions
// without standing up a DB or the Next runtime, the same pattern as
// test-strip-quoted-reply.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { demoPayGuard, quoteDeclineGuard } from "../src/lib/route-guards.ts";

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

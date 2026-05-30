// Standalone unit tests for the time-bounded unsubscribe token (QA2 web LOW).
// Run: node --experimental-strip-types --test scripts/test-unsubscribe-token.mjs
// This repo has no vitest/jest installed (see PLH-3d note). Node 24's built-in
// test runner + native TS strip-types exercises the pure token functions
// without standing up the Next runtime, the same pattern as
// test-route-guards.mjs / test-strip-quoted-reply.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UNSUBSCRIBE_MAX_AGE_MS,
  unsubscribeTokenExpired,
  signUnsubscribeTokenWith,
  verifyUnsubscribeTokenWith,
} from "../src/lib/unsubscribe-token.ts";

const SECRET = "a-test-secret-at-least-16-chars-long";
const NOW = 1_900_000_000_000; // fixed "now" so tests are deterministic
const DAY = 24 * 60 * 60 * 1000;

// ---- unsubscribeTokenExpired predicate ----

test("fresh token is not expired", () => {
  assert.equal(unsubscribeTokenExpired(NOW, NOW), false);
});

test("token issued 89 days ago is not expired (90-day window)", () => {
  assert.equal(unsubscribeTokenExpired(NOW - 89 * DAY, NOW), false);
});

test("token issued 91 days ago is expired", () => {
  assert.equal(unsubscribeTokenExpired(NOW - 91 * DAY, NOW), true);
});

test("token issued exactly at the boundary is not expired", () => {
  assert.equal(unsubscribeTokenExpired(NOW - UNSUBSCRIBE_MAX_AGE_MS, NOW), false);
});

test("token issued in the far future is treated as bogus", () => {
  assert.equal(unsubscribeTokenExpired(NOW + 2 * DAY, NOW), true);
});

test("non-finite / non-positive issued-at is expired", () => {
  assert.equal(unsubscribeTokenExpired(NaN, NOW), true);
  assert.equal(unsubscribeTokenExpired(0, NOW), true);
  assert.equal(unsubscribeTokenExpired(-1, NOW), true);
});

// ---- sign / verify round-trip ----

test("a freshly-issued token verifies and returns the userId", () => {
  const tok = signUnsubscribeTokenWith(SECRET, "user_abc", NOW);
  assert.ok(tok);
  assert.equal(verifyUnsubscribeTokenWith(SECRET, tok, NOW), "user_abc");
});

test("a token from a recent email (10 days old) still verifies", () => {
  const tok = signUnsubscribeTokenWith(SECRET, "user_abc", NOW - 10 * DAY);
  assert.equal(verifyUnsubscribeTokenWith(SECRET, tok, NOW), "user_abc");
});

test("an expired (91-day-old) token is rejected", () => {
  const tok = signUnsubscribeTokenWith(SECRET, "user_abc", NOW - 91 * DAY);
  assert.equal(verifyUnsubscribeTokenWith(SECRET, tok, NOW), null);
});

test("a tampered signature is rejected", () => {
  const tok = signUnsubscribeTokenWith(SECRET, "user_abc", NOW);
  const [uid, issued, sig] = tok.split(".");
  const flipped = sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a");
  assert.equal(verifyUnsubscribeTokenWith(SECRET, `${uid}.${issued}.${flipped}`, NOW), null);
});

test("tampering with the issued-at to extend lifetime is rejected", () => {
  // Take a 91-day-old token and try to rewrite issued-at to now; the sig no
  // longer matches because issued-at is part of the signed payload.
  const tok = signUnsubscribeTokenWith(SECRET, "user_abc", NOW - 91 * DAY);
  const [uid, , sig] = tok.split(".");
  assert.equal(verifyUnsubscribeTokenWith(SECRET, `${uid}.${NOW}.${sig}`, NOW), null);
});

test("a wrong secret cannot verify the token", () => {
  const tok = signUnsubscribeTokenWith(SECRET, "user_abc", NOW);
  assert.equal(verifyUnsubscribeTokenWith("a-different-secret-16chars", tok, NOW), null);
});

test("legacy two-part token (no issued-at) is rejected", () => {
  assert.equal(verifyUnsubscribeTokenWith(SECRET, "user_abc.deadbeefdeadbeefdeadbeef", NOW), null);
});

test("non-numeric issued-at is rejected", () => {
  // Build a token whose middle segment is non-numeric but with a valid-looking shape.
  assert.equal(verifyUnsubscribeTokenWith(SECRET, "user_abc.notanumber.deadbeef", NOW), null);
});

// ---- no-secret refusal ----

test("sign returns null when no secret is configured", () => {
  assert.equal(signUnsubscribeTokenWith(null, "user_abc", NOW), null);
});

test("verify returns null when no secret is configured", () => {
  const tok = signUnsubscribeTokenWith(SECRET, "user_abc", NOW);
  assert.equal(verifyUnsubscribeTokenWith(null, tok, NOW), null);
});

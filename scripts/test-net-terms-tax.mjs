// Unit tests for the net-terms (invoice) Stripe-Tax pure helpers.
// Run: node --experimental-strip-types --test scripts/test-net-terms-tax.mjs
// Same zero-dep Node 24 --test pattern as test-route-guards.mjs: exercises the
// pure decision + reconciliation logic without a DB or the Stripe SDK. The
// Stripe API calls in payments.ts are integration-level and not unit-tested.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveTaxExemptStatus,
  parseUsTaxAddressFromShipTo,
  mergeStripeTax,
} from "../src/lib/net-terms-tax.ts";

// ---- resolveTaxExemptStatus ----

test("exempt buyer maps to Stripe tax_exempt=exempt", () => {
  assert.equal(resolveTaxExemptStatus(true), "exempt");
});

test("non-exempt buyer maps to Stripe tax_exempt=none", () => {
  assert.equal(resolveTaxExemptStatus(false), "none");
});

// ---- parseUsTaxAddressFromShipTo ----

test("parses ZIP + state from a typical ship-to block", () => {
  const a = parseUsTaxAddressFromShipTo(
    "Acme Utility Co, 100 Grid St, Austin, TX, 78701"
  );
  assert.deepEqual(a, { country: "US", postal_code: "78701", state: "TX" });
});

test("parses ZIP+4 down to the 5-digit ZIP", () => {
  const a = parseUsTaxAddressFromShipTo("100 Grid St, Austin TX 78701-1234");
  assert.equal(a.postal_code, "78701");
  assert.equal(a.state, "TX");
});

test("takes the state token nearest the ZIP when several 2-letter tokens exist", () => {
  // "CO" (Company abbrev would be uppercased) and a trailing real state.
  const a = parseUsTaxAddressFromShipTo("NY Power CO, Denver, CO, 80202");
  // Both NY and CO are valid codes; the last valid one (adjacent to ZIP) wins.
  assert.equal(a.state, "CO");
  assert.equal(a.postal_code, "80202");
});

test("returns ZIP-only address when no valid state token is present", () => {
  const a = parseUsTaxAddressFromShipTo("100 Grid St, Springfield, 62704");
  assert.deepEqual(a, { country: "US", postal_code: "62704" });
});

test("returns null when neither ZIP nor state can be read", () => {
  assert.equal(parseUsTaxAddressFromShipTo("To be confirmed"), null);
});

test("returns null on empty / nullish ship-to", () => {
  assert.equal(parseUsTaxAddressFromShipTo(""), null);
  assert.equal(parseUsTaxAddressFromShipTo(null), null);
  assert.equal(parseUsTaxAddressFromShipTo(undefined), null);
});

test("does not treat a non-state 2-letter token as a state", () => {
  // "ST" (street abbrev) is not a USPS code; with no ZIP this is null.
  assert.equal(parseUsTaxAddressFromShipTo("Main ST"), null);
});

// ---- mergeStripeTax ----

test("reconciles to Stripe total when Stripe reports a positive total", () => {
  // subtotal 10000 + freight 2000 + fee 720 = 12720 base; Stripe total carries tax.
  const r = mergeStripeTax(10000, 2000, 720, 825, 13545);
  assert.deepEqual(r, { taxCents: 825, totalCents: 13545 });
});

test("derives total from base + tax when Stripe total is missing", () => {
  const r = mergeStripeTax(10000, 2000, 720, 825, null);
  assert.deepEqual(r, { taxCents: 825, totalCents: 13545 });
});

test("zero tax (exempt or no jurisdiction) leaves total == base", () => {
  const r = mergeStripeTax(10000, 2000, 720, 0, 12720);
  assert.deepEqual(r, { taxCents: 0, totalCents: 12720 });
});

test("floors a negative/NaN tax read to zero and falls back to base total", () => {
  assert.deepEqual(mergeStripeTax(10000, 0, 0, -5, null), {
    taxCents: 0,
    totalCents: 10000,
  });
  assert.deepEqual(mergeStripeTax(10000, 0, 0, Number.NaN, 0), {
    taxCents: 0,
    totalCents: 10000,
  });
});

test("rounds fractional cents from the tax engine", () => {
  const r = mergeStripeTax(10000, 0, 0, 824.6, null);
  assert.equal(r.taxCents, 825);
  assert.equal(r.totalCents, 10825);
});

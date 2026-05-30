// Standalone unit tests for the per-supplier slot math (computePerSupplierSlots)
// and the multi-supplier freight reconciliation that THE order route relies on.
// Run: node --experimental-strip-types --test scripts/test-order-totals.mjs
//
// Background (PLH-QA bug): a real 3-supplier checkout where some suppliers fall
// back to flat ground returned HTTP 500 with "PLH-3g slot math drift". The
// per-supplier freight sum (the server-verified source of truth) exceeded the
// combined-cart flat estimate, and the old belt threw instead of adopting the
// slot sum. These tests lock in that the pure helper returns internally
// consistent slots whose freight sum the caller can adopt without drift, for
// the exact repro numbers and the surcharge-distribution paths.
//
// This repo has no vitest/jest (see PLH-3d note); Node 24's built-in test
// runner + native TS strip-types exercises the pure functions directly.

import { register } from "node:module";
// order-totals.ts imports "./money" / "./freight" extensionless; register a
// resolver so Node's --experimental-strip-types can load the real module.
register("./ts-ext-resolver.mjs", import.meta.url);
import { test } from "node:test";
import assert from "node:assert/strict";
const { computePerSupplierSlots, computeOrderTotals } = await import(
  "../src/lib/order-totals.ts"
);

const FEE_BPS = 600; // matches FEE_RATE_BPS default; only used to sanity-check fees

// A line under the $5,000 free-shipping threshold so the flat-ground fallback
// (FREIGHT_BASE 5900 + 800 per extra line, capped 15000) actually applies.
function line(supplierId, unitPriceCents = 100_000, qty = 1) {
  return { supplierId, unitPriceCents, qty };
}
function freightSum(slots) {
  return slots.reduce((s, x) => s + x.freightCents, 0);
}
function subtotalSum(slots) {
  return slots.reduce((s, x) => s + x.subtotalCents, 0);
}

// ---- THE repro: 3 single-line suppliers on flat-ground fallback ----
// Per-supplier flat = 5900 each => slot freight sum 17700. The combined-cart
// estimate for the same 3 lines is 5900 + 800*2 = 7500. The slot sum exceeds
// the estimate; the function must still return consistent slots (no throw) so
// the caller adopts 17700.
test("3-supplier flat fallback: slot freight sum is 17700 (exceeds 7500 combined estimate), no throw", () => {
  const lines = [line("s1"), line("s2"), line("s3")];
  const slots = computePerSupplierSlots(lines, { feeRateBps: FEE_BPS });
  assert.equal(slots.length, 3);
  for (const s of slots) assert.equal(s.freightCents, 5900);
  assert.equal(freightSum(slots), 17700);
  // The combined-cart estimate the OLD belt compared against:
  const combined = computeOrderTotals(
    lines.map((l) => ({ unitPriceCents: l.unitPriceCents, qty: l.qty }))
  );
  assert.equal(combined.freightCents, 7500);
  // Slot sum > combined estimate is exactly the case that used to 500.
  assert.ok(freightSum(slots) > combined.freightCents);
});

// ---- Verified Shippo cents path: slots use the verified per-supplier cents ----
test("verified freight: each slot adopts its verified cents; sum is the adopted order freight", () => {
  const lines = [line("s1"), line("s2"), line("s3")];
  const verified = new Map([
    ["s1", 6000],
    ["s2", 5000],
    ["s3", 6700],
  ]);
  const slots = computePerSupplierSlots(lines, {
    verifiedFreightBySupplier: verified,
    feeRateBps: FEE_BPS,
  });
  assert.equal(slots.find((s) => s.supplierId === "s1").freightCents, 6000);
  assert.equal(slots.find((s) => s.supplierId === "s2").freightCents, 5000);
  assert.equal(slots.find((s) => s.supplierId === "s3").freightCents, 6700);
  assert.equal(freightSum(slots), 17700);
});

// ---- Surcharge distribution: added on top, sum is exact (no drift) ----
test("surcharge is distributed pro-rata on top of base; slot sum equals base + surcharge exactly", () => {
  const lines = [line("s1"), line("s2"), line("s3")];
  const verified = new Map([
    ["s1", 6000],
    ["s2", 5000],
    ["s3", 6700],
  ]);
  const surchargeCents = 22500; // liftgate 15000 + residential 7500
  const slots = computePerSupplierSlots(lines, {
    verifiedFreightBySupplier: verified,
    surchargeCents,
    feeRateBps: FEE_BPS,
  });
  // No drift: the sum is exactly base (17700) + surcharge (22500).
  assert.equal(freightSum(slots), 17700 + 22500);
  // Every slot got at least its base freight (surcharge only adds).
  assert.ok(slots.find((s) => s.supplierId === "s1").freightCents >= 6000);
});

test("surcharge with all-zero base (free shipping over threshold) splits evenly, sum exact", () => {
  // Each supplier subtotal >= $5,000 threshold => flat freight 0.
  const lines = [line("s1", 600_000), line("s2", 600_000)];
  const slots = computePerSupplierSlots(lines, {
    surchargeCents: 9000,
    feeRateBps: FEE_BPS,
  });
  for (const s of slots) assert.equal(s.subtotalCents, 600_000);
  assert.equal(freightSum(slots), 9000); // base 0 + surcharge 9000, no drift
});

// ---- Single supplier: per-supplier sum equals the combined-cart estimate ----
test("single-supplier cart: slot freight equals the combined-cart flat estimate (unchanged behavior)", () => {
  const lines = [line("s1"), line("s1", 100_000, 1)]; // 2 lines, same supplier
  const slots = computePerSupplierSlots(lines, { feeRateBps: FEE_BPS });
  assert.equal(slots.length, 1);
  // Combined estimate for the same 2 lines:
  const combined = computeOrderTotals(
    lines.map((l) => ({ unitPriceCents: l.unitPriceCents, qty: l.qty }))
  );
  assert.equal(slots[0].freightCents, combined.freightCents); // 5900 + 800 = 6700
  assert.equal(freightSum(slots), combined.freightCents);
});

// ---- Mixed: one verified live rate + one flat fallback ----
test("mixed cart: verified supplier uses live rate, unmatched supplier uses flat fallback; sum adds up", () => {
  const lines = [line("s1"), line("s2")];
  const verified = new Map([["s1", 9000]]); // s2 has no verified rate
  const slots = computePerSupplierSlots(lines, {
    verifiedFreightBySupplier: verified,
    feeRateBps: FEE_BPS,
  });
  assert.equal(slots.find((s) => s.supplierId === "s1").freightCents, 9000);
  assert.equal(slots.find((s) => s.supplierId === "s2").freightCents, 5900);
  assert.equal(freightSum(slots), 14900);
});

// ---- Subtotal partition invariant (the belt that still 500s) ----
test("slot subtotals partition the order subtotal exactly", () => {
  const lines = [line("s1", 100_000, 2), line("s2", 250_000, 1), line("s3")];
  const slots = computePerSupplierSlots(lines, { feeRateBps: FEE_BPS });
  const orderSubtotal = lines.reduce(
    (s, l) => s + l.unitPriceCents * l.qty,
    0
  );
  assert.equal(subtotalSum(slots), orderSubtotal);
});

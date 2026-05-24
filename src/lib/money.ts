export function formatCents(cents: number): string {
  return (
    "$" +
    (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  );
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

// ---------------------------------------------------------------------------
// Marketplace fee schedule.
//
// Marginal tiered model. Each dollar of subtotal is taxed at the rate of the
// bracket it falls in. The rate that gets stored on the Order is the blended
// effective rate, used purely for display/accounting traceability. The
// authoritative fee math always re-runs through feeFor().
// ---------------------------------------------------------------------------

export type FeeTier = {
  /** Upper bound of this bracket in cents (inclusive). Infinity for top tier. */
  upToCents: number;
  /** Basis points (1 bps = 0.01%). 600 = 6.0%. */
  bps: number;
};

export const FEE_TIERS: FeeTier[] = [
  { upToCents:    100_000, bps: 600 }, // first $1,000 at 6.0%
  { upToCents:  1_000_000, bps: 500 }, // $1,000 to $10,000 at 5.0%
  { upToCents:  5_000_000, bps: 400 }, // $10,000 to $50,000 at 4.0%
  { upToCents:  Number.POSITIVE_INFINITY, bps: 300 }, // over $50,000 at 3.0%
];

/** Legacy default rate, kept for compatibility with Order.feeRateBps. */
export const FEE_RATE_BPS = 500;

/**
 * Returns the marketplace fee in cents for the given subtotal. The fee scales
 * marginally across tiers, so there is never a cliff where adding $1 reduces
 * the buyer's bill.
 */
export function feeFor(subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  let fee = 0;
  let remaining = subtotalCents;
  let prevCap = 0;
  for (const tier of FEE_TIERS) {
    const span = tier.upToCents - prevCap;
    const chunk = Math.min(remaining, span);
    fee += Math.round((chunk * tier.bps) / 10000);
    remaining -= chunk;
    prevCap = tier.upToCents;
    if (remaining <= 0) break;
  }
  return fee;
}

/** Blended effective rate (basis points) actually applied to this subtotal. */
export function effectiveBps(subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  return Math.round((feeFor(subtotalCents) * 10000) / subtotalCents);
}

/** "5.1%" style string. Useful for invoice and breakdown copy. */
export function effectiveRateLabel(subtotalCents: number): string {
  const bps = effectiveBps(subtotalCents);
  return `${(bps / 100).toFixed(1)}%`;
}

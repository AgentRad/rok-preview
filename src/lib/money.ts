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
// Marketplace fee. Single config value. Change FEE_RATE_BPS here and every
// surface in the app updates. Documented in LAUNCH_PLAN.md and
// STRATEGY_CONTEXT.md. Each order snapshots its rate at creation time on
// Order.feeRateBps so future config changes never rewrite past orders.
// ---------------------------------------------------------------------------

/** Platform fee in basis points. 600 = 6.0%. Single source of truth. */
export const FEE_RATE_BPS = 600;

/** "6%" style human label. Derived so copy stays in sync with the config. */
export const FEE_RATE_LABEL = `${FEE_RATE_BPS / 100}%`;

export function feeFor(subtotalCents: number, bps: number = FEE_RATE_BPS): number {
  if (subtotalCents <= 0) return 0;
  return Math.round((subtotalCents * bps) / 10000);
}

/** Echoes the configured rate. Stored on Order.feeRateBps at creation time. */
export function effectiveBps(_subtotalCents: number): number {
  return FEE_RATE_BPS;
}

/** "6.0%" style string. Mirrors the configured rate. */
export function effectiveRateLabel(_subtotalCents: number): string {
  return `${(FEE_RATE_BPS / 100).toFixed(1)}%`;
}

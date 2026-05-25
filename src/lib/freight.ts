/**
 * Freight calculation. Single source of truth for what we charge to ship a
 * given order, before we have a real carrier-rate API (Shippo / EasyPost)
 * wired in. The function is deterministic and side-effect-free: pass it the
 * line items, get back the freight amount in cents.
 *
 * Formula (PartsPort launch baseline):
 *
 *   - If any item is `quoteOnly` (configured / large-ticket equipment like
 *     transformers, generators), freight is $0 on the order itself: the
 *     supplier coordinates LTL freight directly with the buyer after the
 *     order is placed. This is industry standard for industrial gear that
 *     does not fit a UPS / FedEx ground envelope.
 *
 *   - Otherwise: a flat handling + ground-rate fee scaled by line count.
 *     `FREIGHT_BASE_CENTS` + `FREIGHT_PER_LINE_CENTS * lineCount`, capped
 *     so we never tack on an absurd fee for a many-line order.
 *
 *   - Subtotal over `FREIGHT_FREE_THRESHOLD_CENTS`: shipping is free
 *     (encourages larger orders, also reflects that the platform fee covers
 *     ground freight at that price point).
 *
 * Tune the constants below as real data comes in. The shape of this fn is
 * stable, so swap it for a Shippo-call later without touching callers.
 */

const FREIGHT_BASE_CENTS = 5_900; // $59 base ground freight
const FREIGHT_PER_LINE_CENTS = 800; // $8 per line item
const FREIGHT_CAP_CENTS = 15_000; // never above $150
const FREIGHT_FREE_THRESHOLD_CENTS = 500_000; // free at $5,000 subtotal

export type FreightInput = {
  /** Itemized lines. quoteOnly flips the entire order to "freight quoted". */
  items: Array<{ quoteOnly?: boolean; qty: number }>;
  subtotalCents: number;
};

export type FreightResult = {
  freightCents: number;
  /** Human-readable basis for the number (shown on invoices). */
  basis:
    | "FREIGHT_QUOTED" // supplier handles LTL after order
    | "FREE_OVER_THRESHOLD"
    | "FLAT_GROUND";
  /** Inline label suitable for the order summary. */
  label: string;
};

export function calculateFreight(input: FreightInput): FreightResult {
  const hasQuoteOnly = input.items.some((i) => i.quoteOnly);
  if (hasQuoteOnly) {
    return {
      freightCents: 0,
      basis: "FREIGHT_QUOTED",
      label: "Freight quoted by supplier (LTL)",
    };
  }
  if (input.subtotalCents >= FREIGHT_FREE_THRESHOLD_CENTS) {
    return {
      freightCents: 0,
      basis: "FREE_OVER_THRESHOLD",
      label: `Free shipping over $${(FREIGHT_FREE_THRESHOLD_CENTS / 100).toLocaleString()}`,
    };
  }
  const lineCount = input.items.reduce((n, i) => n + i.qty, 0);
  const computed =
    FREIGHT_BASE_CENTS + FREIGHT_PER_LINE_CENTS * Math.max(0, lineCount - 1);
  const freightCents = Math.min(computed, FREIGHT_CAP_CENTS);
  return {
    freightCents,
    basis: "FLAT_GROUND",
    label: "Ground shipping (UPS / FedEx)",
  };
}

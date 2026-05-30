// PLH-3z-tax: pure helpers for net-terms (invoice) sales-tax via Stripe Tax.
//
// These are deliberately framework-free (no prisma, no server-only, no Stripe
// SDK) so the Node --test harness can import them directly, the same pattern as
// strip-quoted-reply.ts. The actual Stripe API calls live in payments.ts; this
// module only holds the decision + reconciliation logic the tests can pin.
//
// Background: PREPAID orders collect tax through Stripe Checkout + Stripe Tax.
// Net-terms (NET_15/30/60) orders are billed via a Stripe Invoice. To match
// PREPAID, the net-terms invoice now enables automatic_tax, which requires the
// Stripe Customer to carry a usable tax address. The order only snapshots a
// free-text shipTo string, so we parse a US tax location out of it (Stripe Tax
// resolves the jurisdiction from country + postal code, refined by state when
// we can read one). Tax exemption mirrors the PREPAID path exactly via the same
// lookupTaxExemption(buyerId) source.

export type StripeTaxExemptStatus = "exempt" | "none";

/**
 * Map the platform's boolean exemption (from lookupTaxExemption, the same
 * source the PREPAID/Stripe-Tax path uses) to the Stripe Customer tax_exempt
 * value. "exempt" makes automatic_tax charge zero tax; "none" lets it compute.
 */
export function resolveTaxExemptStatus(isExempt: boolean): StripeTaxExemptStatus {
  return isExempt ? "exempt" : "none";
}

export type UsTaxAddress = {
  country: "US";
  postal_code?: string;
  state?: string;
};

// USPS two-letter codes (50 states + DC + common territories Stripe Tax knows).
const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC", "PR",
  "VI", "GU", "AS", "MP",
]);

/**
 * Best-effort parse of a US tax location from the free-text shipTo block the
 * buyer typed at checkout (format hint: "Company, street, city, state, ZIP").
 * Stripe Tax for the US needs at minimum country + postal_code; it resolves the
 * county/city/state from the ZIP. We additionally try to pull a standalone
 * 2-letter state token (taking the last valid one, which is the one adjacent to
 * the ZIP) to sharpen Stripe's match. Returns null when no ZIP and no state can
 * be read, which the caller treats as "cannot compute tax" and leaves the
 * invoice at zero tax (collection still proceeds).
 */
export function parseUsTaxAddressFromShipTo(
  shipTo: string | null | undefined
): UsTaxAddress | null {
  if (!shipTo) return null;
  // Same 5-digit ZIP regex the freight path already uses on shipTo.
  const postal = shipTo.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1];

  // Standalone 2-letter uppercase tokens that are valid USPS state codes.
  // The state typically sits right before the ZIP, so the LAST match wins.
  let state: string | undefined;
  const tokens = shipTo.toUpperCase().match(/\b[A-Z]{2}\b/g) || [];
  for (const t of tokens) {
    if (US_STATE_CODES.has(t)) state = t;
  }

  if (!postal && !state) return null;
  return {
    country: "US",
    ...(postal ? { postal_code: postal } : {}),
    ...(state ? { state } : {}),
  };
}

/**
 * Reconcile the local Invoice + Order tax/total from the finalized Stripe
 * invoice. stripeTaxCents and stripeTotalCents come straight off the finalized
 * Stripe invoice (the authoritative computed numbers under automatic_tax). When
 * Stripe reports a positive total we trust it verbatim; otherwise we derive the
 * total as base (subtotal + freight + fee) + tax. Negative or NaN tax is
 * floored to 0 so a bad read can never write a negative invoice.
 */
export function mergeStripeTax(
  subtotalCents: number,
  freightCents: number,
  feeCents: number,
  stripeTaxCents: number,
  stripeTotalCents?: number | null
): { taxCents: number; totalCents: number } {
  const tax = Number.isFinite(stripeTaxCents)
    ? Math.max(0, Math.round(stripeTaxCents))
    : 0;
  const base = subtotalCents + freightCents + feeCents;
  const total =
    typeof stripeTotalCents === "number" &&
    Number.isFinite(stripeTotalCents) &&
    stripeTotalCents > 0
      ? Math.round(stripeTotalCents)
      : base + tax;
  return { taxCents: tax, totalCents: total };
}

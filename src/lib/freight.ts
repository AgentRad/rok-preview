/**
 * Freight calculation — pure helpers + types. Safe to import from client
 * AND server. The Shippo SDK wrapper lives in src/lib/freight-server.ts
 * which is server-only.
 *
 * Two layers:
 *   - calculateFreight(): the deterministic flat-rate fallback. Cart +
 *     catalog + checkout summary all call this for the baseline freight
 *     number; the checkout client then overrides via order-totals when
 *     the buyer picks a real-rate quote.
 *   - surchargeCents / describeSurcharges: liftgate / residential /
 *     inside-delivery add-ons priced as constants, picked at checkout.
 */

// ---------------------------------------------------------------------------
// Flat-rate fallback (unchanged from the pre-P9 baseline).
// ---------------------------------------------------------------------------
const FREIGHT_BASE_CENTS = 5_900;
const FREIGHT_PER_LINE_CENTS = 800;
const FREIGHT_CAP_CENTS = 15_000;
const FREIGHT_FREE_THRESHOLD_CENTS = 500_000;

export type FreightInput = {
  items: Array<{ quoteOnly?: boolean; qty: number }>;
  subtotalCents: number;
};

export type FreightResult = {
  freightCents: number;
  basis:
    | "FREIGHT_QUOTED"
    | "FREE_OVER_THRESHOLD"
    | "FLAT_GROUND"
    | "REAL_RATE";
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

// ---------------------------------------------------------------------------
// Real-rate types + surcharge constants. Shared between client + server.
// ---------------------------------------------------------------------------

export type FreightItem = {
  weightLbs: number | null;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  qty: number;
};

export type FreightRate = {
  carrier: string;
  service: string;
  cents: number;
  etaDays: number | null;
  rateId: string | null;
};

export type FreightShipment = {
  supplierId: string;
  supplierName: string;
  originZip: string;
  carrier: string;
  service: string;
  cents: number;
  etaDays: number | null;
};

export type FreightSurcharges = {
  liftgate?: boolean;
  residential?: boolean;
  insideDelivery?: boolean;
};

export const SURCHARGE_CENTS = {
  liftgate: 15_000,
  residential: 7_500,
  insideDelivery: 20_000,
};

export function surchargeCents(
  s: FreightSurcharges | null | undefined
): number {
  if (!s) return 0;
  return (
    (s.liftgate ? SURCHARGE_CENTS.liftgate : 0) +
    (s.residential ? SURCHARGE_CENTS.residential : 0) +
    (s.insideDelivery ? SURCHARGE_CENTS.insideDelivery : 0)
  );
}

export function describeSurcharges(
  s: FreightSurcharges | null | undefined
): string {
  if (!s) return "";
  const parts: string[] = [];
  if (s.liftgate) parts.push("liftgate");
  if (s.residential) parts.push("residential");
  if (s.insideDelivery) parts.push("inside delivery");
  return parts.join(", ");
}

export function sumShipmentCents(shipments: FreightShipment[]): number {
  return shipments.reduce((sum, s) => sum + s.cents, 0);
}

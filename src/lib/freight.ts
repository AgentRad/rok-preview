import "server-only";
import { Shippo } from "shippo";
import { captureError } from "./observability";

/**
 * Freight calculation. Two backends:
 *
 *   1. Shippo real-rate quote when SHIPPO_API_KEY is set AND every line
 *      has weight + length + width + height populated AND we have an
 *      origin warehouse + destination ZIP. Returns up to 5 cheapest rates
 *      from connected carriers (USPS, UPS, FedEx, etc.).
 *
 *   2. Deterministic flat-rate fallback otherwise. Single rate; matches
 *      what /catalog and the cart page have always shown.
 *
 * Tax: Stripe Tax computes tax on (subtotal + freight) at checkout time.
 * We pick the freight cents here; Stripe re-derives tax from that.
 *
 * Surcharges (liftgate / residential / inside-delivery) are added in
 * `surchargeCents` because they vary per-buyer-selection and don't belong
 * in the carrier quote.
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
// Shippo real-rate path (Polish 9 S2).
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
  /** Stable id from Shippo so the buyer's selection survives a refresh. */
  rateId: string | null;
};

let _shippo: Shippo | null = null;
function client(): Shippo | null {
  if (_shippo) return _shippo;
  if (!process.env.SHIPPO_API_KEY) return null;
  _shippo = new Shippo({
    apiKeyHeader: process.env.SHIPPO_API_KEY,
    shippoApiVersion: "2018-02-08",
  });
  return _shippo;
}

export function isShippoConfigured(): boolean {
  return client() !== null;
}

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

/**
 * Aggregate weight + a single bounding box for a multi-line cart. Shippo
 * accepts one parcel per shipment in our pricing model; we sum weight,
 * take the maximum on each dimension, and add a small padding for the
 * pallet/packaging. Good enough for a directional quote at checkout;
 * real shipments use the supplier's actual parcel template when the
 * label is printed (S5).
 */
function aggregateParcel(items: FreightItem[]) {
  let totalWeight = 0;
  let maxLength = 0;
  let maxWidth = 0;
  let maxHeight = 0;
  for (const it of items) {
    if (
      it.weightLbs == null ||
      it.lengthIn == null ||
      it.widthIn == null ||
      it.heightIn == null
    ) {
      return null;
    }
    totalWeight += it.weightLbs * it.qty;
    maxLength = Math.max(maxLength, it.lengthIn);
    maxWidth = Math.max(maxWidth, it.widthIn);
    maxHeight = Math.max(maxHeight, it.heightIn * Math.min(it.qty, 3));
  }
  if (totalWeight <= 0) return null;
  return {
    weightLbs: Math.max(0.1, totalWeight),
    lengthIn: Math.max(1, maxLength + 4),
    widthIn: Math.max(1, maxWidth + 4),
    heightIn: Math.max(1, maxHeight + 2),
  };
}

/**
 * Fetch real-rate freight quotes from Shippo. Returns the top 5 cheapest
 * rates, or empty array when Shippo isn't configured, the parcel can't be
 * aggregated, or the API errors out (Sentry captures the error).
 */
export async function getFreightRates(args: {
  originZip: string;
  destZip: string;
  items: FreightItem[];
}): Promise<FreightRate[]> {
  const s = client();
  if (!s) return [];
  const parcel = aggregateParcel(args.items);
  if (!parcel) return [];
  if (!/^\d{5}/.test(args.originZip) || !/^\d{5}/.test(args.destZip)) {
    return [];
  }
  try {
    const shipment = await s.shipments.create({
      addressFrom: { country: "US", zip: args.originZip },
      addressTo: { country: "US", zip: args.destZip },
      parcels: [
        {
          length: String(parcel.lengthIn),
          width: String(parcel.widthIn),
          height: String(parcel.heightIn),
          distanceUnit: "in",
          weight: String(parcel.weightLbs),
          massUnit: "lb",
        },
      ],
      async: false,
    });
    const rates = (shipment.rates || [])
      .filter((r) => r.amount && r.provider)
      .map((r) => ({
        carrier: String(r.provider || "Carrier"),
        service: String(
          r.servicelevel?.name || r.servicelevel?.token || "Standard"
        ),
        cents: Math.round(Number(r.amount) * 100),
        etaDays:
          typeof r.estimatedDays === "number" ? r.estimatedDays : null,
        rateId: r.objectId || null,
      }))
      .sort((a, b) => a.cents - b.cents)
      .slice(0, 5);
    return rates;
  } catch (err) {
    captureError(err, {
      subsystem: "freight",
      op: "shippo-rates",
      originZip: args.originZip,
      destZip: args.destZip,
    });
    return [];
  }
}

/**
 * Per-supplier-shipment slot of a multi-supplier order (P9 S3). The buyer
 * pays the sum; the order detail page lists them as itemized lines.
 */
export type FreightShipment = {
  supplierId: string;
  supplierName: string;
  originZip: string;
  carrier: string;
  service: string;
  cents: number;
  etaDays: number | null;
};

export function sumShipmentCents(shipments: FreightShipment[]): number {
  return shipments.reduce((sum, s) => sum + s.cents, 0);
}

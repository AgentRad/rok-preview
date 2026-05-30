import "server-only";
import { Shippo } from "shippo";
import { captureError } from "./observability";
import type { FreightItem, FreightRate } from "./freight";

/**
 * Shippo SDK wrapper. Server-only because the Shippo SDK depends on
 * Node-only globals; the public freight helpers in src/lib/freight.ts
 * are pure and safe to import from the client cart + checkout.
 *
 * Gates on SHIPPO_API_KEY: when missing, isShippoConfigured() returns
 * false and getFreightRates() returns []. Callers fall back gracefully
 * to the flat-rate calculator in lib/freight.ts.
 */

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
    const rates: FreightRate[] = (shipment.rates || [])
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

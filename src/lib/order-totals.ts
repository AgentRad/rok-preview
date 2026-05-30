import { feeFor, FEE_RATE_BPS } from "./money";
import { calculateFreight, type FreightResult } from "./freight";

/**
 * The canonical math for an order, in one place. Cart, checkout, order
 * creation, the invoice page, and the receipt email all go through this.
 *
 * Formula (every dollar accounted for):
 *
 *   subtotalCents = sum(line.unitPriceCents * line.qty)
 *   freightCents  = calculateFreight({ items, subtotalCents }).freightCents
 *   feeCents      = round(subtotalCents * FEE_RATE_BPS / 10000)
 *   taxCents      = (provided by Stripe Tax at checkout; otherwise 0)
 *   totalCents    = subtotalCents + freightCents + feeCents + taxCents
 *
 * Tax is left as an input here, NOT computed locally. Tax depends on the
 * ship-to address; Stripe Tax handles it at checkout time and the result
 * gets snapshotted back to Order.taxCents in markOrderPaid. Before payment
 * we render "calculated at checkout"; after payment we render the Stripe
 * snapshot. See src/lib/stripe-tax.ts for the full flow.
 */

export type OrderLine = {
  unitPriceCents: number;
  qty: number;
  quoteOnly?: boolean;
};

export type OrderTotals = {
  subtotalCents: number;
  freightCents: number;
  freight: FreightResult;
  feeCents: number;
  feeRateBps: number;
  taxCents: number;
  totalCents: number;
};

export function computeOrderTotals(
  items: OrderLine[],
  opts: {
    taxCents?: number;
    feeRateBps?: number;
    /**
     * P9 freight override. When checkout passes a buyer-selected rate
     * (real-rate Shippo quote, multi-shipment sum, or surcharge-bumped
     * total), use that instead of the deterministic flat-rate fallback.
     */
    freightOverrideCents?: number;
    freightOverrideLabel?: string;
  } = {}
): OrderTotals {
  const subtotalCents = items.reduce(
    (s, i) => s + i.unitPriceCents * i.qty,
    0
  );
  const fallback = calculateFreight({ items, subtotalCents });
  const freight: FreightResult =
    opts.freightOverrideCents != null
      ? {
          freightCents: opts.freightOverrideCents,
          basis: "REAL_RATE",
          label: opts.freightOverrideLabel || "Selected freight",
        }
      : fallback;
  const bps = opts.feeRateBps ?? FEE_RATE_BPS;
  const feeCents = feeFor(subtotalCents, bps);
  const taxCents = opts.taxCents ?? 0;
  const totalCents = subtotalCents + freight.freightCents + feeCents + taxCents;
  return {
    subtotalCents,
    freightCents: freight.freightCents,
    freight,
    feeCents,
    feeRateBps: bps,
    taxCents,
    totalCents,
  };
}

/**
 * PLH-3g P9: pure helper extracted from /api/orders POST so the
 * per-supplier slot math has a single, testable home. Given the order
 * lines grouped by supplier (each line carrying the supplierId + the
 * dims needed for the flat-rate fallback), plus any server-verified
 * per-supplier freight quotes, return one SlotMath per supplier with
 * its own subtotal, freight, and fee.
 *
 * Each slot's base freight is the server-verified Shippo cents when a
 * matched re-quote exists, else the deterministic per-supplier flat-ground
 * calculation. Any flat surcharge (liftgate / residential / inside delivery)
 * is then distributed pro-rata across slots by base freight, on top of the
 * base, so the slot freight sum is internally consistent and the caller can
 * adopt it directly as the order freight. This is the source of truth for a
 * multi-supplier order: the real freight is the SUM of per-supplier
 * shipments, which is independent of (and typically higher than) any single
 * combined-cart flat estimate.
 */
export type SlotMathLine = {
  supplierId: string;
  unitPriceCents: number;
  qty: number;
  quoteOnly?: boolean;
};
export type SlotMath = {
  supplierId: string;
  subtotalCents: number;
  freightCents: number;
  feeCents: number;
};

export function computePerSupplierSlots(
  lines: SlotMathLine[],
  opts: {
    /** Map supplierId -> verified freight cents from a live Shippo re-quote. */
    verifiedFreightBySupplier?: Map<string, number>;
    /** Flat freight surcharge cents (liftgate / residential / inside delivery)
     *  to distribute pro-rata across slots by base freight, on top of the
     *  per-supplier base. Defaults to 0. */
    surchargeCents?: number;
    feeRateBps?: number;
  }
): SlotMath[] {
  const bps = opts.feeRateBps ?? FEE_RATE_BPS;
  const verified = opts.verifiedFreightBySupplier ?? new Map();
  const itemsBySupplier = new Map<string, SlotMathLine[]>();
  for (const line of lines) {
    const list = itemsBySupplier.get(line.supplierId) || [];
    list.push(line);
    itemsBySupplier.set(line.supplierId, list);
  }
  const slots: SlotMath[] = [];
  for (const [supplierId, supplierItems] of itemsBySupplier) {
    const subtotal = supplierItems.reduce(
      (s, i) => s + i.unitPriceCents * i.qty,
      0
    );
    let freight: number;
    const v = verified.get(supplierId);
    if (v != null) {
      freight = v;
    } else {
      freight = calculateFreight({
        items: supplierItems,
        subtotalCents: subtotal,
      }).freightCents;
    }
    slots.push({
      supplierId,
      subtotalCents: subtotal,
      freightCents: freight,
      feeCents: feeFor(subtotal, bps),
    });
  }
  // Distribute the flat surcharge pro-rata across slots by base freight,
  // largest-remainder style with the last slot taking the rounding remainder,
  // so the slot freight sum equals baseSum + surcharge exactly (no drift).
  const surcharge = Math.max(0, Math.round(opts.surchargeCents ?? 0));
  const baseSum = slots.reduce((s, x) => s + x.freightCents, 0);
  if (surcharge > 0 && slots.length > 0) {
    let remaining = surcharge;
    for (let i = 0; i < slots.length; i++) {
      const isLast = i === slots.length - 1;
      const share = isLast
        ? remaining
        : baseSum > 0
        ? Math.round((surcharge * slots[i].freightCents) / baseSum)
        : Math.floor(surcharge / slots.length);
      slots[i].freightCents += share;
      remaining -= share;
    }
  }
  return slots;
}

/**
 * Format the totals as a plain object suitable for direct writes onto an
 * Order row (creation time). Tax stays 0 here; Stripe Tax fills it in.
 */
export function totalsForOrderRow(items: OrderLine[]) {
  const t = computeOrderTotals(items);
  return {
    subtotalCents: t.subtotalCents,
    freightCents: t.freightCents,
    feeCents: t.feeCents,
    taxCents: 0,
    totalCents: t.totalCents,
    feeRateBps: t.feeRateBps,
  };
}

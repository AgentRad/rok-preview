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
  opts: { taxCents?: number; feeRateBps?: number } = {}
): OrderTotals {
  const subtotalCents = items.reduce(
    (s, i) => s + i.unitPriceCents * i.qty,
    0
  );
  const freight = calculateFreight({ items, subtotalCents });
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

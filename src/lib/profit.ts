import "server-only";
import { prisma } from "./db";

/**
 * Profit + GMV analytics. Pulls from Order, Payout, Refund and computes
 * MTD / YTD KPIs plus per-supplier and per-category breakdowns.
 *
 * Stripe processing cost is estimated client-side (we don't have a fee
 * column on Order today): 2.9% + 30 cents per charge, matching Stripe's
 * standard card pricing. ACH is cheaper at 0.8% capped at $5; we don't
 * track which method was used per order so the estimate uses card rates,
 * which over-estimates slightly when ACH is common. The number is for
 * directional admin reporting, not the books of record.
 */

const CARD_PERCENT = 0.029;
const CARD_FLAT_CENTS = 30;

export type ProfitBucket = {
  gmvCents: number;
  feeRevenueCents: number;
  stripeCostEstimateCents: number;
  netCents: number;
  payoutCents: number;
  refundCents: number;
  paidOrderCount: number;
};

export type SupplierBreakdown = {
  supplierId: string;
  supplierName: string;
  volumeCents: number;
  feeRevenueCents: number;
  supplierEarningsCents: number;
  reserveBalanceCents: number;
};

export type CategoryBreakdown = {
  category: string;
  volumeCents: number;
  feeRevenueCents: number;
  orderCount: number;
};

export type DailyPoint = {
  day: string;        // YYYY-MM-DD
  gmvCents: number;
  feeRevenueCents: number;
};

function estimateStripeCost(gmvCents: number, paidOrders: number): number {
  return Math.round(gmvCents * CARD_PERCENT) + paidOrders * CARD_FLAT_CENTS;
}

async function bucketForRange(start: Date, end: Date): Promise<ProfitBucket> {
  const orders = await prisma.order.findMany({
    where: {
      paidAt: { gte: start, lt: end },
      status: { in: ["PAID", "FULFILLED", "REFUNDED"] },
    },
    select: {
      totalCents: true,
      feeCents: true,
      refundedCents: true,
    },
  });
  const gmvCents = orders.reduce((s, o) => s + o.totalCents, 0);
  const feeRevenueCents = orders.reduce((s, o) => s + o.feeCents, 0);
  const refundCents = orders.reduce((s, o) => s + o.refundedCents, 0);
  const paidOrderCount = orders.length;
  const stripeCostEstimateCents = estimateStripeCost(gmvCents, paidOrderCount);

  const payouts = await prisma.payout.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      status: { in: ["PROCESSING", "PAID"] },
    },
    select: { amountCents: true },
  });
  const payoutCents = payouts.reduce((s, p) => s + p.amountCents, 0);

  return {
    gmvCents,
    feeRevenueCents,
    stripeCostEstimateCents,
    netCents: feeRevenueCents - stripeCostEstimateCents,
    payoutCents,
    refundCents,
    paidOrderCount,
  };
}

export async function getProfitDashboard() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const yearEnd = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));

  const [mtd, ytd] = await Promise.all([
    bucketForRange(monthStart, monthEnd),
    bucketForRange(yearStart, yearEnd),
  ]);

  // Per-supplier MTD breakdown.
  const suppliers = await prisma.supplier.findMany({
    select: {
      id: true,
      name: true,
      reserveBalanceCents: true,
      products: {
        select: {
          orderItems: {
            where: {
              order: {
                paidAt: { gte: monthStart, lt: monthEnd },
                status: { in: ["PAID", "FULFILLED", "REFUNDED"] },
              },
            },
            select: { unitPriceCents: true, qty: true, order: { select: { feeRateBps: true } } },
          },
        },
      },
    },
  });
  const supplierBreakdown: SupplierBreakdown[] = suppliers
    .map((s) => {
      let volumeCents = 0;
      let feeRevenueCents = 0;
      for (const product of s.products) {
        for (const item of product.orderItems) {
          const lineCents = item.unitPriceCents * item.qty;
          volumeCents += lineCents;
          feeRevenueCents += Math.round(
            (lineCents * (item.order.feeRateBps || 600)) / 10000
          );
        }
      }
      return {
        supplierId: s.id,
        supplierName: s.name,
        volumeCents,
        feeRevenueCents,
        supplierEarningsCents: volumeCents - feeRevenueCents,
        reserveBalanceCents: s.reserveBalanceCents,
      };
    })
    .filter((row) => row.volumeCents > 0 || row.reserveBalanceCents > 0)
    .sort((a, b) => b.volumeCents - a.volumeCents);

  // Per-category MTD breakdown.
  const orderItemsMtd = await prisma.orderItem.findMany({
    where: {
      order: {
        paidAt: { gte: monthStart, lt: monthEnd },
        status: { in: ["PAID", "FULFILLED", "REFUNDED"] },
      },
    },
    select: {
      orderId: true,
      unitPriceCents: true,
      qty: true,
      product: { select: { category: true } },
      order: { select: { feeRateBps: true } },
    },
  });
  const categoryMap = new Map<
    string,
    { volumeCents: number; feeRevenueCents: number; orders: Set<string> }
  >();
  for (const item of orderItemsMtd) {
    const cat = item.product.category;
    const lineCents = item.unitPriceCents * item.qty;
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, { volumeCents: 0, feeRevenueCents: 0, orders: new Set() });
    }
    const entry = categoryMap.get(cat)!;
    entry.volumeCents += lineCents;
    entry.feeRevenueCents += Math.round(
      (lineCents * (item.order.feeRateBps || 600)) / 10000
    );
    entry.orders.add(item.orderId);
  }
  const categoryBreakdown: CategoryBreakdown[] = Array.from(categoryMap.entries())
    .map(([category, v]) => ({
      category,
      volumeCents: v.volumeCents,
      feeRevenueCents: v.feeRevenueCents,
      orderCount: v.orders.size,
    }))
    .sort((a, b) => b.volumeCents - a.volumeCents);

  // Daily trend (last 30 days).
  const last30Start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dailyOrders = await prisma.order.findMany({
    where: {
      paidAt: { gte: last30Start },
      status: { in: ["PAID", "FULFILLED", "REFUNDED"] },
    },
    select: { paidAt: true, totalCents: true, feeCents: true },
  });
  const dailyMap = new Map<string, { gmv: number; fee: number }>();
  for (const o of dailyOrders) {
    if (!o.paidAt) continue;
    const day = o.paidAt.toISOString().slice(0, 10);
    if (!dailyMap.has(day)) dailyMap.set(day, { gmv: 0, fee: 0 });
    const entry = dailyMap.get(day)!;
    entry.gmv += o.totalCents;
    entry.fee += o.feeCents;
  }
  const daily: DailyPoint[] = Array.from(dailyMap.entries())
    .map(([day, v]) => ({
      day,
      gmvCents: v.gmv,
      feeRevenueCents: v.fee,
    }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  return { mtd, ytd, supplierBreakdown, categoryBreakdown, daily };
}

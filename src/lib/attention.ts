import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "./db";
import { formatCents } from "./money";

export type AttentionSeverity = "info" | "warning" | "urgent";

export type AttentionItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  actionLabel: string;
  actionHref: string;
  severity: AttentionSeverity;
  /** Optional sort hint; older issues bubble up within the same severity. */
  createdAt?: Date;
};

/**
 * One entry point per role. Each branch pulls from data the platform already
 * has and returns lightweight cards sorted urgent -> warning -> info, then
 * oldest first within each severity so stale items don't get buried.
 */
export async function getBuyerAttention(buyerId: string): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];

  const [pending, quoted, shipped, fulfilled] = await Promise.all([
    prisma.order.findMany({
      where: { buyerId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { id: true, reference: true, totalCents: true, createdAt: true },
    }),
    prisma.quoteRequest.findMany({
      where: { buyerId, status: "QUOTED" },
      orderBy: { quotedAt: "asc" },
      include: { product: { select: { name: true } } },
    }),
    prisma.order.findMany({
      where: {
        buyerId,
        shipmentStage: "Shipped",
        status: { not: "FULFILLED" },
      },
      orderBy: { paidAt: "asc" },
      select: {
        id: true,
        reference: true,
        carrier: true,
        trackingCode: true,
        paidAt: true,
      },
    }),
    prisma.order.findMany({
      where: { buyerId, status: "FULFILLED" },
      include: {
        items: { select: { productId: true, nameSnapshot: true } },
        reviews: { select: { productId: true } },
      },
      orderBy: { paidAt: "desc" },
      take: 5,
    }),
  ]);

  for (const o of pending) {
    items.push({
      id: `pay-${o.id}`,
      kind: "payment-due",
      title: `Pay for order ${o.reference}`,
      body: `Total ${formatCents(o.totalCents)}. The supplier waits on payment to start preparing your parts.`,
      actionLabel: "Pay now",
      actionHref: `/orders/${o.id}`,
      severity: "urgent",
      createdAt: o.createdAt,
    });
  }

  for (const q of quoted) {
    items.push({
      id: `quote-${q.id}`,
      kind: "quote-ready",
      title: `Quote ready: ${q.product.name}`,
      body: `Supplier responded on RFQ ${q.reference}. Review and accept or pass.`,
      actionLabel: "View quote",
      actionHref: `/quotes/${q.id}`,
      severity: "warning",
      createdAt: q.quotedAt ?? undefined,
    });
  }

  for (const o of shipped) {
    items.push({
      id: `shipped-${o.id}`,
      kind: "shipment-in-transit",
      title: `Order ${o.reference} is on the way`,
      body: o.carrier
        ? `Tracked via ${o.carrier}${o.trackingCode ? ` (${o.trackingCode})` : ""}.`
        : "Tracking will appear when the carrier scans the package.",
      actionLabel: "Track",
      actionHref: `/orders/${o.id}`,
      severity: "info",
      createdAt: o.paidAt ?? undefined,
    });
  }

  for (const o of fulfilled) {
    const reviewedProductIds = new Set(o.reviews.map((r) => r.productId));
    const unreviewed = o.items.filter(
      (i) => !reviewedProductIds.has(i.productId)
    );
    if (unreviewed.length === 0) continue;
    items.push({
      id: `review-${o.id}`,
      kind: "review-request",
      title: `Leave a review for order ${o.reference}`,
      body: `Real reviews help other buyers trust this catalog. Takes a minute.`,
      actionLabel: "Write review",
      actionHref: `/orders/${o.id}`,
      severity: "info",
    });
  }

  // Reorder reminder: the most recent FULFILLED order older than 30 days that
  // isn't already cancelled or open elsewhere on the feed.
  const oldFulfilled = await prisma.order.findFirst({
    where: {
      buyerId,
      status: "FULFILLED",
      paidAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { paidAt: "desc" },
    select: { id: true, reference: true, paidAt: true },
  });
  if (oldFulfilled) {
    items.push({
      id: `reorder-${oldFulfilled.id}`,
      kind: "reorder-reminder",
      title: `Reorder from ${oldFulfilled.reference}?`,
      body: `Your last delivered order was over 30 days ago. Reorder in one click and skip the search.`,
      actionLabel: "Reorder",
      actionHref: `/account`,
      severity: "info",
    });
  }

  return sortFeed(items);
}

export async function getSupplierAttention(
  supplierId: string
): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];

  const [openRfqs, ordersToShip, payoutsDue, lowStock] = await Promise.all([
    prisma.quoteRequest.findMany({
      where: { status: "OPEN", product: { supplierId } },
      orderBy: { createdAt: "asc" },
      include: { product: { select: { name: true } } },
    }),
    // PLH-3g P8: scope the "to ship" feed to THIS supplier's slot. On a
    // multi-supplier order, the order-level shipmentStage might already
    // be "Partial: 1 of 2 shipped" while this supplier still hasn't
    // shipped their slot; the old query missed those.
    prisma.order
      .findMany({
        where: {
          status: "PAID",
          supplierSlots: {
            some: {
              supplierId,
              shipmentStage: { notIn: ["Shipped", "Delivered"] },
            },
          },
        },
        orderBy: { paidAt: "asc" },
        select: {
          id: true,
          reference: true,
          paidAt: true,
          shipmentStage: true,
          supplierSlots: {
            where: { supplierId },
            select: { shipmentStage: true },
          },
        },
        take: 10,
      })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          reference: r.reference,
          paidAt: r.paidAt,
          // Surface the slot stage (this supplier's view), not the
          // cross-supplier aggregate.
          shipmentStage: r.supplierSlots[0]?.shipmentStage ?? r.shipmentStage,
        }))
      ),
    prisma.payout.findMany({
      where: { supplierId, status: "DUE" },
      orderBy: { createdAt: "asc" },
      select: { id: true, amountCents: true, createdAt: true },
    }),
    prisma.product.findMany({
      where: { supplierId, active: true, quoteOnly: false, stock: { lte: 5 } },
      orderBy: { stock: "asc" },
      take: 10,
      select: { id: true, sku: true, name: true, stock: true },
    }),
  ]);

  if (openRfqs.length > 0) {
    const oldest = openRfqs[0];
    const hours = Math.max(
      0,
      Math.floor((Date.now() - oldest.createdAt.getTime()) / 3_600_000)
    );
    items.push({
      id: `rfqs-open`,
      kind: "rfqs-open",
      title: `${openRfqs.length} RFQ${openRfqs.length === 1 ? "" : "s"} waiting on your quote`,
      body: `Oldest is ${hours}h old (${oldest.product.name}). Quote speed drives buyer trust.`,
      actionLabel: "Respond to oldest",
      actionHref: `/quotes/${oldest.id}`,
      severity: hours > 24 ? "urgent" : "warning",
      createdAt: oldest.createdAt,
    });
  }

  if (ordersToShip.length > 0) {
    const oldest = ordersToShip[0];
    items.push({
      id: `to-ship`,
      kind: "orders-to-ship",
      title: `${ordersToShip.length} paid order${ordersToShip.length === 1 ? "" : "s"} ready to ship`,
      body: `Mark ${oldest.reference} as Processing or Shipped when the carrier picks it up.`,
      actionLabel: "View oldest",
      actionHref: `/orders/${oldest.id}`,
      severity: "warning",
      createdAt: oldest.paidAt ?? undefined,
    });
  }

  if (payoutsDue.length > 0) {
    const total = payoutsDue.reduce((s, p) => s + p.amountCents, 0);
    items.push({
      id: `payouts-due`,
      kind: "payouts-due",
      title: `${formatCents(total)} in payouts due`,
      body: `${payoutsDue.length} payout${payoutsDue.length === 1 ? "" : "s"} scheduled. PartsPort releases on cleared funds.`,
      actionLabel: "View payouts",
      actionHref: `/supplier#payouts`,
      severity: "info",
    });
  }

  for (const p of lowStock) {
    items.push({
      id: `stock-${p.id}`,
      kind: "low-stock",
      title:
        p.stock === 0
          ? `${p.sku} is out of stock`
          : `${p.sku} is at ${p.stock} unit${p.stock === 1 ? "" : "s"}`,
      body: `${p.name}. Update stock or buyers see backorder.`,
      actionLabel: "Update stock",
      actionHref: `/supplier`,
      severity: p.stock === 0 ? "warning" : "info",
    });
  }

  return sortFeed(items);
}

export async function getManufacturerAttention(
  brand: string | null
): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  if (!brand) return items;

  // Demand signal: search events that mention this brand. Naive contains
  // match; good enough for the v1 attention card.
  const [recent, prior, ownProducts] = await Promise.all([
    prisma.searchEvent.count({
      where: {
        query: { contains: brand, mode: "insensitive" },
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.searchEvent.count({
      where: {
        query: { contains: brand, mode: "insensitive" },
        createdAt: {
          gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.product.findMany({
      where: { manufacturer: brand, active: true, stock: 0 },
      take: 5,
      select: { id: true, sku: true, name: true, supplier: { select: { name: true } } },
    }),
  ]);

  if (recent > 0) {
    const delta = prior > 0 ? Math.round(((recent - prior) / prior) * 100) : null;
    items.push({
      id: `demand-${brand}`,
      kind: "demand",
      title: `${recent} buyer search${recent === 1 ? "" : "es"} for ${brand} this week`,
      body:
        delta === null
          ? `First baseline for this brand; we'll start trending next week.`
          : `${delta >= 0 ? "Up" : "Down"} ${Math.abs(delta)}% vs the prior week.`,
      actionLabel: "View demand",
      actionHref: `/oem`,
      severity: "info",
    });
  }

  for (const p of ownProducts) {
    items.push({
      id: `backorder-${p.id}`,
      kind: "backorder",
      title: `${p.sku} is out of stock at ${p.supplier.name}`,
      body: `${p.name}. Coordinate restock so authorized distributors can fulfill.`,
      actionLabel: "Notify distributor",
      actionHref: `/oem`,
      severity: "warning",
    });
  }

  return sortFeed(items);
}

export async function getAdminAttention(): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];

  // Admin attention is platform-level operations: applications, returns,
  // payouts, late shipments. Supplier-team chores (pending team invites,
  // catalog completeness, etc.) belong on the supplier's own dashboard and
  // were dropped from here to stop the cross-leakage.
  const [pendingApps, openReturns, duePayouts, lateShipments, bankPending] =
    await Promise.all([
      prisma.supplierApplication.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: { id: true, companyName: true, createdAt: true },
      }),
      prisma.returnRequest.count({ where: { status: "OPEN" } }),
      prisma.payout.aggregate({
        where: { status: "DUE" },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      prisma.order.findMany({
        where: {
          shipmentStage: "Shipped",
          status: { not: "FULFILLED" },
          // Heuristic for "late": shipped over 7 days ago and not yet delivered.
          paidAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { paidAt: "asc" },
        take: 5,
        select: { id: true, reference: true, carrier: true, paidAt: true },
      }),
      // PLH-1 commit 4: suppliers with a fresh bank-info PENDING summary.
      // Surfaces "Acme Corp changed their payout last4 to 1234" so the
      // admin re-verifies before the next payout cycle runs.
      prisma.supplier.findMany({
        where: {
          bankInfoStatus: "PENDING",
          bankInfoUpdatedAt: { not: null },
        },
        orderBy: { bankInfoUpdatedAt: "desc" },
        take: 10,
        select: {
          id: true,
          name: true,
          bankInfoLast4: true,
          bankInfoUpdatedAt: true,
        },
      }),
    ]);

  if (pendingApps.length > 0) {
    items.push({
      id: `apps`,
      kind: "applications",
      title: `${pendingApps.length} supplier application${pendingApps.length === 1 ? "" : "s"} waiting`,
      body: `Oldest: ${pendingApps[0].companyName}. Approve or reject from /admin.`,
      actionLabel: "Review oldest",
      actionHref: `/admin`,
      severity: "warning",
      createdAt: pendingApps[0].createdAt,
    });
  }

  if (openReturns > 0) {
    items.push({
      id: `returns`,
      kind: "returns",
      title: `${openReturns} return request${openReturns === 1 ? "" : "s"} open`,
      body: `Approve, reject, or resolve. Buyers are waiting on a decision.`,
      actionLabel: "View",
      actionHref: `/admin`,
      severity: "warning",
    });
  }

  const payoutsTotal = duePayouts._sum.amountCents ?? 0;
  if ((duePayouts._count._all ?? 0) > 0) {
    items.push({
      id: `payouts-process`,
      kind: "payouts",
      title: `${formatCents(payoutsTotal)} in supplier payouts to process`,
      body: `${duePayouts._count._all} payout${duePayouts._count._all === 1 ? "" : "s"} ready. Mark Paid as you settle them.`,
      actionLabel: "Process",
      actionHref: `/ops`,
      severity: "warning",
    });
  }

  for (const s of bankPending) {
    items.push({
      id: `bank-${s.id}`,
      kind: "bank-info-updated",
      title: `${s.name} updated bank details (****${s.bankInfoLast4 ?? "????"})`,
      body: `New payout destination is PENDING re-verification. Confirm against the supplier's W-9 or voided check before the next payout.`,
      actionLabel: "Review",
      actionHref: `/admin`,
      severity: "warning",
      createdAt: s.bankInfoUpdatedAt ?? undefined,
    });
  }

  for (const o of lateShipments) {
    items.push({
      id: `late-${o.id}`,
      kind: "late-shipment",
      title: `${o.reference} is past its delivery window`,
      body: `${o.carrier ?? "Carrier unknown"} hasn't reported Delivered. Investigate before the buyer escalates.`,
      actionLabel: "Investigate",
      actionHref: `/orders/${o.id}`,
      severity: "urgent",
      createdAt: o.paidAt ?? undefined,
    });
  }

  return sortFeed(items);
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  urgent: 0,
  warning: 1,
  info: 2,
};

function sortFeed(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (s !== 0) return s;
    const ad = a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bd = b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return ad - bd;
  });
}

/** Convenience entry point that dispatches by role. */
export async function getAttentionFeed(
  user: User,
  options: { supplierId?: string } = {}
): Promise<AttentionItem[]> {
  switch (user.role) {
    case "BUYER":
      return getBuyerAttention(user.id);
    case "SUPPLIER":
      return options.supplierId ? getSupplierAttention(options.supplierId) : [];
    case "MANUFACTURER":
      return getManufacturerAttention(user.manufacturerName);
    case "ADMIN":
      return getAdminAttention();
    default:
      return [];
  }
}

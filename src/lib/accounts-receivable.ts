import "server-only";
import { prisma } from "./db";
import type { PaymentTerms } from "@prisma/client";

// PLH-3z-3: A/R aging is computed from the invoice due date on unpaid
// net-terms invoices (DUE + PAST_DUE). PREPAID invoices use ISSUED -> PAID and
// never enter this report.
const UNPAID_STATUSES = ["DUE", "PAST_DUE"] as const;

export type AgingBuckets = {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
};

export function emptyBuckets(): AgingBuckets {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
}

/** Whole days past due. Negative or zero means not yet due. */
export function daysPastDue(dueDate: Date | null, now: Date): number {
  if (!dueDate) return 0;
  return Math.floor((now.getTime() - dueDate.getTime()) / 86400000);
}

export function bucketKey(daysPast: number): keyof AgingBuckets {
  if (daysPast <= 0) return "current";
  if (daysPast <= 30) return "d1_30";
  if (daysPast <= 60) return "d31_60";
  if (daysPast <= 90) return "d61_90";
  return "d90plus";
}

export type OrgRollup = {
  orgId: string | null;
  orgName: string;
  terms: PaymentTerms | null;
  creditLimitCents: number | null;
  outstandingCents: number;
  overdueCents: number;
  availableCents: number | null;
  oldestAgeDays: number;
  status: string;
  invoiceCount: number;
};

export type SupplierExposure = {
  supplierName: string;
  exposureCents: number;
};

export type ArDashboard = {
  totalOutstandingCents: number;
  totalOverdueCents: number;
  orgsWithArCount: number;
  avgDaysToPay: number | null;
  totalFrontedCents: number;
  aging: AgingBuckets;
  orgs: OrgRollup[];
  supplierExposure: SupplierExposure[];
};

/** Outstanding balance on a single unpaid invoice, never negative. */
function outstandingOf(totalCents: number, partialPaidCents: number): number {
  return Math.max(0, totalCents - partialPaidCents);
}

export async function loadArDashboard(now = new Date()): Promise<ArDashboard> {
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: [...UNPAID_STATUSES] } },
    select: {
      totalCents: true,
      partialPaidCents: true,
      dueDate: true,
      order: {
        select: {
          buyerOrgId: true,
          invoiceDueDate: true,
          supplierSlots: {
            select: {
              subtotalCents: true,
              freightCents: true,
              shipmentStage: true,
              supplier: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const orgIds = Array.from(
    new Set(invoices.map((i) => i.order.buyerOrgId).filter((x): x is string => !!x))
  );
  const orgs = orgIds.length
    ? await prisma.buyerOrg.findMany({
        where: { id: { in: orgIds } },
        select: { id: true, name: true, paymentTerms: true, creditLimitCents: true, status: true },
      })
    : [];
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  const aging = emptyBuckets();
  const rollups = new Map<string, OrgRollup>();
  const exposure = new Map<string, number>();
  let totalOutstanding = 0;
  let totalOverdue = 0;

  for (const inv of invoices) {
    const out = outstandingOf(inv.totalCents, inv.partialPaidCents);
    if (out <= 0) continue;
    const due = inv.dueDate ?? inv.order.invoiceDueDate ?? null;
    const past = daysPastDue(due, now);
    aging[bucketKey(past)] += out;
    totalOutstanding += out;
    if (past > 0) totalOverdue += out;

    const orgId = inv.order.buyerOrgId;
    const key = orgId ?? "__unassigned__";
    let r = rollups.get(key);
    if (!r) {
      const org = orgId ? orgById.get(orgId) : undefined;
      r = {
        orgId,
        orgName: org?.name ?? "Unassigned",
        terms: org?.paymentTerms ?? null,
        creditLimitCents: org?.creditLimitCents ?? null,
        outstandingCents: 0,
        overdueCents: 0,
        availableCents: null,
        oldestAgeDays: 0,
        // PLH-3z-4: real org credit-suspension status.
        status: org?.status ?? "ACTIVE",
        invoiceCount: 0,
      };
      rollups.set(key, r);
    }
    r.outstandingCents += out;
    if (past > 0) r.overdueCents += out;
    if (past > r.oldestAgeDays) r.oldestAgeDays = past;
    r.invoiceCount += 1;

    // PLH-3z-4 float exposure: under the locked pay-after-buyer-pays policy,
    // PartsPort's net-terms exposure is what has SHIPPED on an unpaid invoice
    // (the supplier delivered goods; PartsPort owes that supplier once the
    // buyer pays, and eats the gap net of reserve if the buyer defaults). Only
    // count Shipped/Delivered slots.
    for (const slot of inv.order.supplierSlots) {
      if (slot.shipmentStage !== "Shipped" && slot.shipmentStage !== "Delivered") continue;
      const name = slot.supplier?.name ?? "Unknown supplier";
      exposure.set(name, (exposure.get(name) ?? 0) + slot.subtotalCents + slot.freightCents);
    }
  }

  for (const r of rollups.values()) {
    if (r.creditLimitCents != null) {
      r.availableCents = r.creditLimitCents - r.outstandingCents;
    }
  }

  // Total fronted to suppliers: disbursed payouts on orders whose invoice is
  // still unpaid. PartsPort's working-capital exposure at a glance.
  const frontedPayouts = await prisma.payout.findMany({
    where: {
      status: "PAID",
      order: { invoice: { status: { in: [...UNPAID_STATUSES] } } },
    },
    select: { amountCents: true },
  });
  const totalFronted = frontedPayouts.reduce((n, p) => n + p.amountCents, 0);

  // Average days-to-pay over the last 90 days (paidAt - issuedAt mean).
  const since = new Date(now.getTime() - 90 * 86400000);
  const paid = await prisma.invoice.findMany({
    where: { status: "PAID", paidAt: { gte: since } },
    select: { issuedAt: true, paidAt: true },
  });
  let avgDaysToPay: number | null = null;
  if (paid.length) {
    const totalDays = paid.reduce((n, p) => {
      if (!p.paidAt) return n;
      return n + (p.paidAt.getTime() - p.issuedAt.getTime()) / 86400000;
    }, 0);
    avgDaysToPay = totalDays / paid.length;
  }

  const orgList = Array.from(rollups.values()).sort(
    (a, b) => b.outstandingCents - a.outstandingCents
  );
  const supplierExposure = Array.from(exposure.entries())
    .map(([supplierName, exposureCents]) => ({ supplierName, exposureCents }))
    .sort((a, b) => b.exposureCents - a.exposureCents);

  return {
    totalOutstandingCents: totalOutstanding,
    totalOverdueCents: totalOverdue,
    orgsWithArCount: orgList.length,
    avgDaysToPay,
    totalFrontedCents: totalFronted,
    aging,
    orgs: orgList,
    supplierExposure,
  };
}

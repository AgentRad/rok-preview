import "server-only";
import { prisma } from "./db";
import { writeAuditLog } from "./audit";
import { captureError } from "./observability";
import { signOrderViewToken } from "./order-link";
import { siteUrl } from "./site-url";
import {
  sendDunningEmail,
  sendBuyerOrgSuspended,
  sendBuyerOrgReactivated,
} from "./email";

/**
 * PLH-3z-4: dunning + auto-suspend + auto-reactivate (final net-30 round).
 *
 * Cadence (LOCKED): T-3 gentle, T0 due today, T+7 firm, T+30 final notice +
 * auto-suspend. Idempotency is the InvoiceDunningLog table (unique
 * invoiceId+stage), so a stage email fires exactly once per invoice no matter
 * how many times the cron runs (there is no Email model in this codebase).
 */

export const MAX_PER_RUN = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

type Stage = "T-3" | "T0" | "T+7" | "T+30";

// Suspend threshold is env-configurable per the PLH-3j P12 pattern; default 30.
function suspendDaysPastDue(): number {
  const n = Number(process.env.AR_SUSPEND_DAYS_PAST_DUE);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

// Outstanding balance under which a suspended org auto-reactivates. Default 0
// (must be fully cleared).
function reactivateThresholdCents(): number {
  const n = Number(process.env.AR_REACTIVATE_THRESHOLD_CENTS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function daysFromDue(due: Date, now: Date): number {
  return Math.floor((now.getTime() - due.getTime()) / DAY_MS);
}

/**
 * The most-advanced cadence stage an invoice has reached given days-from-due.
 * Returns null when the invoice is not yet within the T-3 window. Sending only
 * the highest reached stage avoids backfilling stale earlier stages when the
 * cron missed a day; each stage still fires at most once via InvoiceDunningLog.
 */
function reachedStage(days: number, suspendDay: number): Stage | null {
  if (days >= suspendDay) return "T+30";
  if (days >= 7) return "T+7";
  if (days >= 0) return "T0";
  if (days >= -3) return "T-3";
  return null;
}

/** Self-service pay link: hosted Stripe ACH page when present, else the
 * on-platform invoice page (signed token for guest access). */
function payLinkFor(invoice: {
  stripeHostedInvoiceUrl: string | null;
  order: { id: string; buyerId: string | null; buyerEmail: string };
}): string {
  if (invoice.stripeHostedInvoiceUrl) return invoice.stripeHostedInvoiceUrl;
  const base = `/orders/${invoice.order.id}/invoice`;
  if (invoice.order.buyerId) return siteUrl(base);
  const token = signOrderViewToken(invoice.order.id, invoice.order.buyerEmail);
  return siteUrl(`${base}?t=${token}`);
}

async function orgAdmins(orgId: string) {
  const members = await prisma.buyerOrgMember.findMany({
    where: { buyerOrgId: orgId, role: "ADMIN" },
    include: { user: { select: { email: true, name: true } } },
  });
  return members
    .map((m) => ({ email: m.user?.email ?? "", name: m.user?.name ?? null }))
    .filter((a) => a.email);
}

/** Sum of unpaid (DUE/PAST_DUE) invoice totals for an org's orders. */
export async function orgOutstandingCents(orgId: string): Promise<number> {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ["DUE", "PAST_DUE"] },
      order: { is: { buyerOrgId: orgId } },
    },
    select: { totalCents: true, partialPaidCents: true },
  });
  return invoices.reduce(
    (sum, i) => sum + Math.max(0, i.totalCents - i.partialPaidCents),
    0
  );
}

/**
 * Suspend an org for a 30-day past-due balance. Idempotent (no-op if already
 * SUSPENDED). Emails org admins and audits.
 */
export async function suspendOrgForDunning(orgId: string): Promise<void> {
  const org = await prisma.buyerOrg.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, status: true },
  });
  if (!org || org.status === "SUSPENDED") return;

  await prisma.buyerOrg.update({
    where: { id: orgId },
    data: {
      status: "SUSPENDED",
      suspendedAt: new Date(),
      suspendedReason: "dunning_30_days",
    },
  });
  await writeAuditLog({
    actor: { id: "system", email: "system@partsport.cron" },
    action: "BUYER_ORG_SUSPENDED",
    targetType: "BuyerOrg",
    targetId: orgId,
    summary: `Org ${org.name} suspended for a 30-day past-due net-terms balance.`,
    metadata: { reason: "dunning_30_days" },
  });
  for (const admin of await orgAdmins(orgId)) {
    try {
      await sendBuyerOrgSuspended({
        to: admin.email,
        orgName: org.name,
        recipientName: admin.name,
      });
    } catch (err) {
      captureError(err, { subsystem: "email", op: "org-suspended", orgId });
    }
  }
}

/**
 * Auto-reactivate a SUSPENDED org once its outstanding balance falls to/below
 * the reactivate threshold (default 0). Called after every net-terms payment
 * (invoice.paid webhook + manual mark-paid). Best-effort: never throws into the
 * payment path.
 */
export async function maybeReactivateOrg(orgId: string | null | undefined): Promise<void> {
  if (!orgId) return;
  try {
    const org = await prisma.buyerOrg.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, status: true },
    });
    if (!org || org.status !== "SUSPENDED") return;
    const outstanding = await orgOutstandingCents(orgId);
    if (outstanding > reactivateThresholdCents()) return;

    await prisma.buyerOrg.update({
      where: { id: orgId },
      data: { status: "ACTIVE", suspendedAt: null, suspendedReason: null },
    });
    await writeAuditLog({
      actor: { id: "system", email: "system@partsport" },
      action: "BUYER_ORG_REACTIVATED",
      targetType: "BuyerOrg",
      targetId: orgId,
      summary: `Org ${org.name} reactivated: past-due balance cleared.`,
      metadata: { outstandingCents: outstanding },
    });
    for (const admin of await orgAdmins(orgId)) {
      try {
        await sendBuyerOrgReactivated({
          to: admin.email,
          orgName: org.name,
          recipientName: admin.name,
        });
      } catch (err) {
        captureError(err, { subsystem: "email", op: "org-reactivated", orgId });
      }
    }
  } catch (err) {
    captureError(err, { subsystem: "dunning", op: "maybe-reactivate", orgId });
  }
}

/**
 * Cron body. Walks unpaid DUE/PAST_DUE invoices oldest-first, computes
 * days-from-due, and sends the most-advanced cadence stage that has not yet
 * been logged. At the suspend day it flips the org to SUSPENDED. Bounded
 * MAX_PER_RUN with a hasMore flag (mirrors PLH-2 4e).
 */
export async function runArDunning(): Promise<{
  processed: number;
  sent: number;
  suspended: number;
  errors: string[];
  hasMore: boolean;
}> {
  const now = new Date();
  const suspendDay = suspendDaysPastDue();

  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["DUE", "PAST_DUE"] } },
    take: MAX_PER_RUN + 1,
    orderBy: { issuedAt: "asc" },
    select: {
      id: true,
      number: true,
      totalCents: true,
      status: true,
      dueDate: true,
      stripeHostedInvoiceUrl: true,
      order: {
        select: {
          id: true,
          buyerId: true,
          buyerName: true,
          buyerEmail: true,
          buyerOrgId: true,
          invoiceDueDate: true,
        },
      },
    },
  });
  const hasMore = invoices.length > MAX_PER_RUN;
  const batch = hasMore ? invoices.slice(0, MAX_PER_RUN) : invoices;

  let sent = 0;
  let suspended = 0;
  const errors: string[] = [];

  for (const inv of batch) {
    try {
      const due = inv.dueDate ?? inv.order.invoiceDueDate;
      if (!due) continue; // not a net-terms invoice with a due date
      const days = daysFromDue(due, now);

      // Housekeeping: flip DUE -> PAST_DUE once past the due date.
      if (days >= 1 && inv.status === "DUE") {
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { status: "PAST_DUE" },
        });
      }

      const stage = reachedStage(days, suspendDay);
      if (!stage) continue;

      const already = await prisma.invoiceDunningLog.findUnique({
        where: { invoiceId_stage: { invoiceId: inv.id, stage } },
      });
      if (already) {
        // Stage already handled. Still ensure suspend happened for T+30 in case
        // a prior run logged the email but failed before suspending.
        if (stage === "T+30" && inv.order.buyerOrgId) {
          await suspendOrgForDunning(inv.order.buyerOrgId);
        }
        continue;
      }

      const suspendDate = new Date(due.getTime() + (suspendDay + 1) * DAY_MS);
      await sendDunningEmail({
        to: inv.order.buyerEmail,
        buyerId: inv.order.buyerId,
        buyerName: inv.order.buyerName,
        invoiceNumber: inv.number,
        orderId: inv.order.id,
        buyerEmail: inv.order.buyerEmail,
        totalCents: inv.totalCents,
        dueDate: due,
        stage,
        payUrl: payLinkFor(inv),
        suspendDate,
      });

      await prisma.invoiceDunningLog.create({
        data: { invoiceId: inv.id, stage },
      });
      sent++;

      await writeAuditLog({
        actor: { id: "system", email: "system@partsport.cron" },
        action: "AR_DUNNING_SENT",
        targetType: "Invoice",
        targetId: inv.id,
        summary: `Dunning stage ${stage} sent for invoice ${inv.number} (${days} days from due).`,
        metadata: { invoiceId: inv.id, stage, daysFromDue: days },
      });

      // T+30: auto-suspend the org (LOCKED). Idempotent.
      if (stage === "T+30" && inv.order.buyerOrgId) {
        await suspendOrgForDunning(inv.order.buyerOrgId);
        suspended++;
      }
    } catch (err) {
      captureError(err, { subsystem: "cron", op: "ar-dunning", invoiceId: inv.id });
      errors.push(`${inv.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { processed: batch.length, sent, suspended, errors, hasMore };
}

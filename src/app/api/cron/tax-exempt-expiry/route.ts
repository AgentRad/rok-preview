import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";
import { sendTaxExemptExpiryNotice } from "@/lib/email";

export const runtime = "nodejs";

/**
 * PLH-3j P4: daily tax-exempt cert expiry reminder.
 *
 * Finds APPROVED certs expiring within the next 30 days and emails the
 * buyer once per row per window. Idempotent guard: we re-fire reminders
 * inside the 30-day window only if no TAX_EXEMPT_EXPIRY_NOTICE audit
 * row exists for that address within the last 25 days. This keeps a
 * second reminder from going out daily for the same cert while still
 * giving us a top-up if the buyer ignored the first one.
 *
 * Schedule: vercel.json runs this at 04:30 UTC daily, in the housekeeping
 * window (after cleanup-unverified/anonymize, before the money crons).
 */

const MAX_PER_RUN = 200;
const REMINDER_WINDOW_DAYS = 30;
const REPEAT_SUPPRESSION_DAYS = 25;

async function adminActor() {
  return { id: "system", email: "system@partsport.cron" };
}

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 86400000);
  const repeatCutoff = new Date(now.getTime() - REPEAT_SUPPRESSION_DAYS * 86400000);

  const expiring = await prisma.address.findMany({
    where: {
      deletedAt: null,
      taxExemptStatus: "APPROVED",
      taxExemptExpiresAt: {
        not: null,
        gt: now,
        lte: cutoff,
      },
    },
    take: MAX_PER_RUN + 1,
    orderBy: { taxExemptExpiresAt: "asc" },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });
  const hasMore = expiring.length > MAX_PER_RUN;
  const batch = hasMore ? expiring.slice(0, MAX_PER_RUN) : expiring;

  let notified = 0;
  let suppressed = 0;
  const errors: string[] = [];
  const actor = await adminActor();

  for (const a of batch) {
    try {
      // Idempotency guard: skip if we already wrote a notice for this
      // address within the suppression window.
      const recent = await prisma.auditLog.findFirst({
        where: {
          action: "TAX_EXEMPT_EXPIRY_NOTICE",
          targetType: "Address",
          targetId: a.id,
          createdAt: { gte: repeatCutoff },
        },
        select: { id: true },
      });
      if (recent) {
        suppressed++;
        continue;
      }
      const expiresAt = a.taxExemptExpiresAt!;
      const daysLeft = Math.max(
        0,
        Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000)
      );
      await sendTaxExemptExpiryNotice({
        to: a.user.email,
        recipientName: a.user.name || a.recipient || a.user.email,
        addressLabel: a.label || a.recipient || "your saved address",
        expiresAt,
        daysLeft,
      });
      await writeAuditLog({
        actor,
        action: "TAX_EXEMPT_EXPIRY_NOTICE",
        targetType: "Address",
        targetId: a.id,
        summary: `Sent expiry reminder for ${a.user.email} (cert expires ${expiresAt.toISOString().slice(0, 10)}, ${daysLeft} days left).`,
        metadata: {
          userId: a.user.id,
          expiresAt: expiresAt.toISOString(),
          daysLeft,
        },
      });
      notified++;
    } catch (err) {
      captureError(err, {
        subsystem: "cron",
        op: "tax-exempt-expiry",
        addressId: a.id,
      });
      errors.push(`${a.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    processed: batch.length,
    notified,
    suppressed,
    errors,
    hasMore,
  });
}

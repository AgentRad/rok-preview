import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PLH-1 commit 2: after the 30-day grace window, scrub PII off
 * soft-deleted users. Order rows are deliberately left intact for tax /
 * accounting retention.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const targets = await prisma.user.findMany({
    where: {
      deletedAt: { lt: cutoff },
      anonymizedAt: null,
    },
    select: { id: true, email: true, name: true },
  });
  let anonymized = 0;
  const errors: string[] = [];
  for (const u of targets) {
    try {
      await prisma.user.update({
        where: { id: u.id },
        data: {
          email: `deleted-${u.id}@partsport.local`,
          name: "Deleted User",
          anonymizedAt: new Date(),
        },
      });
      anonymized += 1;
      await writeAuditLog({
        actor: { id: "system", email: "system@cron" },
        action: "USER_ANONYMIZED",
        targetType: "User",
        targetId: u.id,
        summary: `Anonymized PII for soft-deleted user past 30-day grace window.`,
        metadata: { originalEmail: u.email },
      });
    } catch (err) {
      captureError(err, {
        subsystem: "cron",
        cron: "anonymize-deleted-accounts",
        userId: u.id,
      });
      errors.push(u.id);
    }
  }
  return NextResponse.json({
    ok: true,
    scanned: targets.length,
    anonymized,
    errors: errors.length,
  });
}

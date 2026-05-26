import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PLH-1 commit 2: nightly cleanup of never-verified accounts.
 * Removes User rows where emailVerified IS NULL and createdAt is older
 * than 7 days. Anything tied to a real order should have been verified
 * (state-changing endpoints gate on isEmailVerified), so hard-deleting
 * here is safe.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const stale = await prisma.user.findMany({
    where: { emailVerified: null, createdAt: { lt: cutoff } },
    select: { id: true, email: true, createdAt: true },
  });
  let deleted = 0;
  const errors: string[] = [];
  for (const u of stale) {
    try {
      await prisma.user.delete({ where: { id: u.id } });
      deleted += 1;
      await writeAuditLog({
        actor: { id: "system", email: "system@cron" },
        action: "USER_DELETED_UNVERIFIED",
        targetType: "User",
        targetId: u.id,
        summary: `Hard-deleted unverified account (${u.email}) older than 7 days.`,
        metadata: { originalEmail: u.email, createdAt: u.createdAt.toISOString() },
      });
    } catch (err) {
      captureError(err, {
        subsystem: "cron",
        cron: "cleanup-unverified-accounts",
        userId: u.id,
      });
      errors.push(u.id);
    }
  }
  return NextResponse.json({
    ok: true,
    scanned: stale.length,
    deleted,
    errors: errors.length,
  });
}

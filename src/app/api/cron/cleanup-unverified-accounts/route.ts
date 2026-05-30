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
  // PLH-3j P6: bounded, oldest-first, hasMore in response.
  const MAX_PER_RUN = 200;
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const found = await prisma.user.findMany({
    where: { emailVerified: null, createdAt: { lt: cutoff } },
    select: { id: true, email: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: MAX_PER_RUN + 1,
  });
  const hasMore = found.length > MAX_PER_RUN;
  const stale = hasMore ? found.slice(0, MAX_PER_RUN) : found;
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
    hasMore,
  });
}

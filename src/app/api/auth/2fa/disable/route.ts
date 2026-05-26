import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createSession, getCurrentUser, verifyPassword } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { sendTwoFactorDisabled } from "@/lib/email";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Disable 2FA. Requires the user's current password again so a stolen
 * session cookie alone can't drop the second factor.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const limit = await rateLimit("generic", ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const password = String(body.password || "");
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 400 }
    );
  }

  // PLH-1: disabling 2FA invalidates every outstanding session for this
  // user. The current browser gets a fresh cookie below.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpSecret: null,
      totpEnabledAt: null,
      totpBackupCodes: Prisma.DbNull,
      sessionsValidFrom: new Date(),
    },
  });
  await createSession(user.id);

  // PLH-1 commit 2: paper trail + email so attackers can't silently strip
  // the factor.
  const when = new Date();
  await writeAuditLog({
    actor: { id: user.id, email: user.email },
    action: "TWO_FACTOR_DISABLED",
    targetType: "User",
    targetId: user.id,
    summary: `2FA disabled for ${user.email} from ${ip}.`,
    metadata: { ip },
  });
  if (process.env.RESEND_API_KEY) {
    try {
      await sendTwoFactorDisabled({
        to: user.email,
        name: user.name,
        ip,
        when,
      });
    } catch {
      // Non-fatal.
    }
  }

  return NextResponse.json({ ok: true });
}

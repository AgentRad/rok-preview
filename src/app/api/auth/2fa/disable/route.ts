import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createSession, getCurrentUser, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Disable 2FA. Requires the user's current password again so a stolen
 * session cookie alone can't drop the second factor.
 */
export async function POST(req: Request) {
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

  // PLH-1: disabling 2FA is a sensitive auth change; invalidate every
  // outstanding session for this user. The current browser gets a fresh
  // cookie below.
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

  return NextResponse.json({ ok: true });
}

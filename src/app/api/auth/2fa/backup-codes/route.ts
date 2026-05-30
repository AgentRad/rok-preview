import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, verifyPassword } from "@/lib/auth";
import { generateBackupCodes, hashBackupCode } from "@/lib/totp";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * PLH-3w P2: regenerate the 8 single-use backup codes. Requires the
 * current password and an already-enabled 2FA. Returns the plain codes
 * once; only hashes are stored. Regenerating invalidates any previously
 * issued codes (the array is replaced wholesale + the legacy column is
 * cleared).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const rl = await rateLimit("generic", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  if (!user.totpEnabledAt) {
    return NextResponse.json(
      { error: "Enable two-factor authentication first." },
      { status: 400 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const password = String(body.password || "");
  if (!password || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 400 }
    );
  }

  const codes = generateBackupCodes();
  const hashed = codes.map((c) => hashBackupCode(c));
  await prisma.user.update({
    where: { id: user.id },
    data: { backupCodesHashed: hashed, totpBackupCodes: Prisma.DbNull },
  });

  return NextResponse.json({ ok: true, backupCodes: codes });
}

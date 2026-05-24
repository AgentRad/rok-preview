import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, verifyPassword } from "@/lib/auth";
import { generateSecret, totpUrl } from "@/lib/totp";

export const runtime = "nodejs";

/**
 * Start an enrollment. Requires the user's current password to confirm
 * intent. Generates a fresh TOTP secret and stores it in totpSecret. The
 * user must then submit a valid code to /api/auth/2fa/verify; only then is
 * totpEnabledAt set, which actually turns enforcement on at login.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const password = String(body.password || "");
  if (!password) {
    return NextResponse.json(
      { error: "Current password is required to enable 2FA." },
      { status: 400 }
    );
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 400 }
    );
  }

  const secret = generateSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpSecret: secret,
      totpEnabledAt: null,
      totpBackupCodes: Prisma.DbNull,
    },
  });

  return NextResponse.json({
    ok: true,
    secret,
    otpauthUrl: totpUrl({ secret, accountName: user.email }),
  });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  generateBackupCodes,
  hashBackupCode,
  verifyTotp,
} from "@/lib/totp";

export const runtime = "nodejs";

/**
 * Confirm a pending 2FA enrollment by submitting a valid code from the
 * authenticator app. On first success we flip totpEnabledAt and generate
 * single-use backup codes. The plain backup codes are returned in the
 * response once and only once; only the hashes are stored.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  if (!user.totpSecret) {
    return NextResponse.json(
      { error: "Start enrollment via /api/auth/2fa/enroll first." },
      { status: 400 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const code = String(body.code || "");
  if (!verifyTotp(user.totpSecret, code)) {
    return NextResponse.json(
      { error: "That code does not match. Try the current code from your authenticator." },
      { status: 400 }
    );
  }

  const codes = generateBackupCodes();
  const hashed = codes.map((c) => hashBackupCode(c));

  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpEnabledAt: new Date(),
      totpBackupCodes: hashed,
    },
  });

  return NextResponse.json({
    ok: true,
    enabledAt: new Date().toISOString(),
    backupCodes: codes,
  });
}

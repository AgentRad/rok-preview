import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { hashBackupCode, verifyTotp } from "@/lib/totp";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const secret = new TextEncoder().encode(
  process.env.SESSION_SECRET || "insecure-dev-secret-please-override-in-prod"
);

/**
 * Second step of the 2FA login: client posts back the 5-minute ticket from
 * /api/auth/login plus the 6-digit authenticator code (or one of the
 * single-use backup codes the user saved at enrollment).
 */
export async function POST(req: Request) {
  // Share the login bucket so an attacker can't bypass the password limit
  // by hammering the 2FA endpoint with stolen tickets.
  const limit = await rateLimit("login", clientIp(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please wait a few minutes." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      }
    );
  }
  const body = await req.json().catch(() => ({}));
  const ticket = String(body.ticket || "");
  const code = String(body.code || "");

  if (!ticket || !code) {
    return NextResponse.json({ error: "Code is required." }, { status: 400 });
  }

  let uid: string;
  try {
    const { payload } = await jwtVerify(ticket, secret);
    if (payload.kind !== "2fa-pending" || typeof payload.uid !== "string") {
      throw new Error("bad ticket");
    }
    uid = payload.uid as string;
  } catch {
    return NextResponse.json(
      { error: "This sign-in step expired. Please sign in with email and password again." },
      { status: 401 }
    );
  }

  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user || !user.totpEnabledAt || !user.totpSecret) {
    return NextResponse.json(
      { error: "Two-factor authentication is no longer enabled on this account." },
      { status: 400 }
    );
  }

  if (verifyTotp(user.totpSecret, code)) {
    await createSession(user.id);
    return NextResponse.json({ ok: true, role: user.role });
  }

  // Try backup codes (single-use, hashed at rest).
  const storedHashes = (user.totpBackupCodes as string[] | null) ?? [];
  const candidateHash = hashBackupCode(code);
  const matchIndex = storedHashes.indexOf(candidateHash);
  if (matchIndex >= 0) {
    const remaining = storedHashes.filter((_, i) => i !== matchIndex);
    await prisma.user.update({
      where: { id: user.id },
      data: { totpBackupCodes: remaining },
    });
    await createSession(user.id);
    return NextResponse.json({
      ok: true,
      role: user.role,
      backupCodeUsed: true,
      remainingBackupCodes: remaining.length,
    });
  }

  return NextResponse.json(
    { error: "That code does not match. Try the latest one from your authenticator." },
    { status: 401 }
  );
}

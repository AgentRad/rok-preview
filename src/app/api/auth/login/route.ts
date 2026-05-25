import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const secret = new TextEncoder().encode(
  process.env.SESSION_SECRET || "insecure-dev-secret-please-override-in-prod"
);

export async function POST(req: Request) {
  const limit = rateLimit("login", clientIp(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please wait a few minutes." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      }
    );
  }
  const { email, password } = await req.json().catch(() => ({}));
  const normalized = String(email || "").toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user || !(await verifyPassword(String(password || ""), user.passwordHash))) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  // 2FA gate. Password was right, but we don't drop the session cookie yet;
  // instead we return a short-lived ticket the client passes to login-2fa
  // along with the authenticator code.
  if (user.totpEnabledAt) {
    const ticket = await new SignJWT({ uid: user.id, kind: "2fa-pending" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(secret);
    return NextResponse.json({
      ok: false,
      requires2FA: true,
      ticket,
    });
  }

  await createSession(user.id);
  return NextResponse.json({ ok: true, role: user.role });
}

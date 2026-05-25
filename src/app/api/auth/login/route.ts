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
  const ip = clientIp(req);
  const ipLimit = await rateLimit("login", ip);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please wait a minute." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(ipLimit.retryAfterMs / 1000)) },
      }
    );
  }
  const { email, password } = await req.json().catch(() => ({}));
  const normalized = String(email || "").toLowerCase().trim();
  // Per-(IP, email) limit catches the case where one IP rotates between
  // many guessed emails: the per-IP bucket above keeps replenishing as
  // the bot moves to the next address.
  if (normalized) {
    const pairLimit = await rateLimit("login:email", `${ip}|${normalized}`);
    if (!pairLimit.allowed) {
      return NextResponse.json(
        { error: "Too many sign-in attempts for this email. Try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(pairLimit.retryAfterMs / 1000)),
          },
        }
      );
    }
  }
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user || !(await verifyPassword(String(password || ""), user.passwordHash))) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }
  // Soft-deleted accounts can't sign in until they hit the recovery link
  // mailed when /api/account/delete fired. Hint the user at the email so
  // they don't think the password's wrong.
  if (user.deletedAt) {
    return NextResponse.json(
      {
        error:
          "This account is scheduled for deletion. Check your email for the recovery link we sent, or wait until the grace period ends.",
        code: "ACCOUNT_DELETED",
      },
      { status: 403 }
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

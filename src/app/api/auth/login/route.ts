import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession, getSessionSecret } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import {
  issueAccountToken,
  TOKEN_TYPES,
} from "@/lib/account-tokens";
import { sendDeletedAccountSignInAttempt } from "@/lib/email";
import { siteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

const INVALID_RESPONSE = {
  body: { error: "Invalid email or password." },
  status: 401 as const,
};

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
    return NextResponse.json(INVALID_RESPONSE.body, { status: INVALID_RESPONSE.status });
  }
  // PLH-1 commit 2: no enumeration on deleted accounts. Public response
  // is the same generic 401 the wrong-password case returns. We mail the
  // owner a heads-up so the real user notices a deleted-account sign-in
  // attempt (and gets the recovery link in their inbox even if the
  // original deletion email was missed).
  if (user.deletedAt) {
    if (process.env.RESEND_API_KEY) {
      try {
        const raw = await issueAccountToken({
          userId: user.id,
          type: TOKEN_TYPES.ACCOUNT_RECOVERY,
          expiresInMs: 30 * 24 * 60 * 60 * 1000,
        });
        await sendDeletedAccountSignInAttempt({
          to: user.email,
          name: user.name,
          recoverUrl: siteUrl(`/api/account/recover?token=${raw}`),
        });
      } catch {
        // Non-fatal.
      }
    }
    return NextResponse.json(INVALID_RESPONSE.body, { status: INVALID_RESPONSE.status });
  }

  // PLH-3w P1: account trust gate. Suspended and banned accounts cannot
  // sign in. Banned gets the same generic copy as suspended so the page
  // doesn't confirm the harsher state. 403, not 401, since the
  // credentials were valid but the account is locked.
  if (user.status === "SUSPENDED" || user.status === "BANNED") {
    return NextResponse.json(
      {
        error:
          "This account is not available. If you believe this is a mistake, contact support@partsport.com.",
      },
      { status: 403 }
    );
  }

  // 2FA gate. Password was right, but we don't drop the session cookie yet.
  if (user.totpEnabledAt) {
    const ticket = await new SignJWT({ uid: user.id, kind: "2fa-pending" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(getSessionSecret());
    return NextResponse.json({
      ok: false,
      requires2FA: true,
      ticket,
    });
  }

  await createSession(user.id);
  return NextResponse.json({ ok: true, role: user.role });
}

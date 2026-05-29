import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession, getTicketSecret } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import {
  issueAccountToken,
  TOKEN_TYPES,
} from "@/lib/account-tokens";
import { sendDeletedAccountSignInAttempt } from "@/lib/email";
import { siteUrl } from "@/lib/site-url";
import { findEnforcedSsoForEmail } from "@/lib/sso";
import { writeAuditLog } from "@/lib/audit";

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

  // PLH-3y-4: SSO domain lock. When the user's email domain belongs to an org
  // that enforces SSO, password login is disabled. Two break-glass paths stay
  // open: a platform admin (Role=ADMIN) always keeps password access, and a
  // member explicitly granted emergencyPasswordAccess on that org may sign in.
  // Both are audited as EMERGENCY_PASSWORD_LOGIN. Otherwise we return 403 with
  // an ssoInitiateUrl the login page redirects to.
  const enforced = await findEnforcedSsoForEmail(normalized);
  if (enforced) {
    const isPlatformAdmin = user.role === "ADMIN";
    const breakGlassMember = isPlatformAdmin
      ? null
      : await prisma.buyerOrgMember.findUnique({
          where: {
            buyerOrgId_userId: {
              buyerOrgId: enforced.buyerOrgId,
              userId: user.id,
            },
          },
          select: { emergencyPasswordAccess: true },
        });
    const allowBreakGlass =
      isPlatformAdmin || breakGlassMember?.emergencyPasswordAccess === true;
    if (!allowBreakGlass) {
      return NextResponse.json(
        {
          error: "Your organization requires single sign-on.",
          ssoInitiateUrl: `/api/auth/sso/initiate?email=${encodeURIComponent(
            normalized
          )}`,
        },
        { status: 403 }
      );
    }
    await writeAuditLog({
      actor: user,
      action: "EMERGENCY_PASSWORD_LOGIN",
      targetType: "User",
      targetId: user.id,
      summary: `Break-glass password login by ${normalized} into an SSO-enforced domain (${
        isPlatformAdmin ? "platform admin" : "org emergency access"
      }).`,
      metadata: { buyerOrgId: enforced.buyerOrgId, isPlatformAdmin },
    });
  }

  // 2FA gate. Password was right, but we don't drop the session cookie yet.
  if (user.totpEnabledAt) {
    // Signed with the domain-separated ticket secret, NOT the session secret,
    // so this ticket can never be verified as a real pp_session cookie.
    const ticket = await new SignJWT({ uid: user.id, kind: "2fa-pending" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(getTicketSecret());
    return NextResponse.json({
      ok: false,
      requires2FA: true,
      ticket,
    });
  }

  await createSession(user.id);
  return NextResponse.json({ ok: true, role: user.role });
}

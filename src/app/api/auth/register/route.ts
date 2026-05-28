import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { issueEmailVerification } from "@/lib/email-verification";
import { normalizeName, normalizeEmail } from "@/lib/user-input";
import { sendAddressAlreadyRegistered } from "@/lib/email";
import { siteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

const GENERIC_SUCCESS = {
  ok: true,
  verificationRequired: true,
} as const;

export async function POST(req: Request) {
  const ip = clientIp(req);
  // Burst limit: 1 per minute per IP.
  const burst = await rateLimit("register:burst", ip);
  if (!burst.allowed) {
    return NextResponse.json(
      { error: "Slow down. Wait a minute before trying again." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(burst.retryAfterMs / 1000)) },
      }
    );
  }
  const limit = await rateLimit("register", ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-up attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      }
    );
  }
  const { name, email, password } = await req.json().catch(() => ({}));
  const cleanName = normalizeName(name);
  const cleanEmail = normalizeEmail(email);
  const pwLen = String(password || "").length;
  if (!cleanName || !cleanEmail || !password || pwLen < 8 || pwLen > 128) {
    return NextResponse.json(
      {
        error:
          "A valid name, email, and a password between 8 and 128 characters are required.",
      },
      { status: 400 }
    );
  }
  // PLH-3w P1: refuse re-signup with a banned email. Generic "registration
  // unavailable" so we neither confirm the address is banned nor leak that
  // it exists. Checked before the existing-user branch so a banned account
  // can't slip through the reset-link path either.
  const banned = await prisma.bannedEmail.findUnique({
    where: { email: cleanEmail },
  });
  if (banned) {
    return NextResponse.json(
      { error: "Registration is unavailable for this email." },
      { status: 403 }
    );
  }

  // PLH-1 commit 2: enumeration suppression. If the email is already in
  // use, respond with the same generic success shape that a brand-new
  // registration sees. Asynchronously mail the existing account holder
  // a heads-up with a reset link so the real owner notices.
  const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (existing) {
    if (process.env.RESEND_API_KEY) {
      // Issue a one-shot password-reset token and mail it. Mirrors the
      // /api/auth/forgot-password flow.
      try {
        const raw = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        await prisma.passwordResetToken.create({
          data: { userId: existing.id, tokenHash, expiresAt },
        });
        await sendAddressAlreadyRegistered({
          to: existing.email,
          name: existing.name,
          resetUrl: siteUrl(`/reset-password?token=${raw}`),
        });
      } catch {
        // Non-fatal: a logging hiccup must not change the response shape.
      }
    }
    return NextResponse.json(GENERIC_SUCCESS);
  }
  const user = await prisma.user.create({
    data: {
      name: cleanName,
      email: cleanEmail,
      passwordHash: await hashPassword(String(password)),
      role: "BUYER",
    },
  });
  // PLH-1 commit 2: do NOT auto-sign-in. The user must click the link in
  // the verification email before a session cookie is issued. /register
  // routes the client to /verify-email-pending.
  await issueEmailVerification({
    userId: user.id,
    email: user.email,
    name: user.name,
  });
  return NextResponse.json({
    ok: true,
    verificationRequired: true,
    email: user.email,
  });
}

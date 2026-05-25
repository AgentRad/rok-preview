import "server-only";
import crypto from "node:crypto";
import { prisma } from "./db";
import { siteUrl } from "./site-url";
import { sendEmailVerification } from "./email";

const TOKEN_BYTES = 32;
const EXPIRES_HOURS = 24;
const RESEND_COOLDOWN_MS = 60_000;

/**
 * Generates a new verification token, persists it on the user, and sends
 * the verification email via Resend. No-op (returns ok=false) when the
 * email backend is not configured; the verification link is also logged
 * via the link returned so an admin can hand it to the user out of band.
 *
 * Idempotent in the sense that calling it again BEFORE the cooldown
 * returns { ok: false, cooldownMs }. After the cooldown it rotates the
 * token.
 */
export async function issueEmailVerification(args: {
  userId: string;
  email: string;
  name: string;
  /** Allow shortening the cooldown for admin-triggered resends. */
  bypassCooldown?: boolean;
}): Promise<
  | { ok: true; verifyUrl: string }
  | { ok: false; cooldownMs: number; reason: "cooldown" }
> {
  const user = await prisma.user.findUnique({ where: { id: args.userId } });
  if (!user) return { ok: false, cooldownMs: 0, reason: "cooldown" };
  if (!args.bypassCooldown && user.emailVerificationSentAt) {
    const elapsed = Date.now() - user.emailVerificationSentAt.getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      return {
        ok: false,
        cooldownMs: RESEND_COOLDOWN_MS - elapsed,
        reason: "cooldown",
      };
    }
  }
  const token = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + EXPIRES_HOURS * 60 * 60 * 1000);
  await prisma.user.update({
    where: { id: args.userId },
    data: {
      emailVerificationToken: token,
      emailVerificationExpiresAt: expiresAt,
      emailVerificationSentAt: new Date(),
    },
  });
  const verifyUrl = siteUrl(`/api/auth/verify?token=${token}`);
  await sendEmailVerification({
    to: args.email,
    name: args.name,
    verifyUrl,
    expiresHours: EXPIRES_HOURS,
  });
  return { ok: true, verifyUrl };
}

/**
 * Consume a verification token. Returns the user when the token is valid
 * and unexpired; clears the token + sets emailVerified.
 */
export async function consumeEmailVerification(token: string) {
  if (!token) return null;
  const user = await prisma.user.findUnique({
    where: { emailVerificationToken: token },
  });
  if (!user || !user.emailVerificationExpiresAt) return null;
  if (user.emailVerificationExpiresAt.getTime() < Date.now()) return null;
  return prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: new Date(),
      emailVerificationToken: null,
      emailVerificationExpiresAt: null,
    },
  });
}

/** Convenience predicate for gating endpoints. */
export function isEmailVerified(user: {
  emailVerified: Date | null;
}): boolean {
  return user.emailVerified !== null;
}

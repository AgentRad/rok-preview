import "server-only";
import crypto from "node:crypto";
import { prisma } from "./db";
import { siteUrl } from "./site-url";
import { sendEmailVerification } from "./email";

const TOKEN_BYTES = 32;
const EXPIRES_HOURS = 24;
const RESEND_COOLDOWN_MS = 60_000;

/** Hex-encoded SHA-256 of the raw token. Matches the at-rest format used
 * by PasswordResetToken and AccountToken. */
function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function hashEmailVerificationToken(raw: string): string {
  return hashToken(raw);
}

/**
 * Generates a new verification token, persists it on the user, and sends
 * the verification email via Resend. No-op (returns ok=false) when the
 * email backend is not configured; the verification link is also logged
 * via the link returned so an admin can hand it to the user out of band.
 *
 * Idempotent in the sense that calling it again BEFORE the cooldown
 * returns { ok: false, cooldownMs }. After the cooldown it rotates the
 * token.
 *
 * PLH-1: only the hash is stored at rest. The raw token lives in memory
 * for the time it takes to build the URL and hand it to Resend.
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
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + EXPIRES_HOURS * 60 * 60 * 1000);
  await prisma.user.update({
    where: { id: args.userId },
    data: {
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: expiresAt,
      emailVerificationSentAt: new Date(),
    },
  });
  const verifyUrl = siteUrl(`/api/auth/verify?token=${rawToken}`);
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
 *
 * PLH-1: look up by hash, then use timingSafeEqual on the hash bytes as
 * defense in depth against any future short-circuit comparison.
 */
export async function consumeEmailVerification(rawToken: string) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const user = await prisma.user.findUnique({
    where: { emailVerificationTokenHash: tokenHash },
  });
  if (!user || !user.emailVerificationTokenHash) return null;
  const candidate = Buffer.from(tokenHash, "hex");
  const stored = Buffer.from(user.emailVerificationTokenHash, "hex");
  if (
    candidate.length !== stored.length ||
    !crypto.timingSafeEqual(candidate, stored)
  ) {
    return null;
  }
  if (!user.emailVerificationExpiresAt) return null;
  if (user.emailVerificationExpiresAt.getTime() < Date.now()) return null;
  return prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: new Date(),
      emailVerificationTokenHash: null,
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

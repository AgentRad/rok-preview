import "server-only";
import crypto from "node:crypto";
import { prisma } from "./db";
import { siteUrl } from "./site-url";

/**
 * PLH-1 commit 3: shared helper for issuing a password-reset token and
 * returning the absolute URL we drop into an email. Mirrors the
 * /api/auth/forgot-password flow exactly so a token minted here is
 * indistinguishable from one a user requested themselves.
 */

export const PASSWORD_RESET_EXPIRES_MINUTES = 60;

export async function issuePasswordResetUrl(userId: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  await prisma.passwordResetToken.create({
    data: {
      tokenHash,
      userId,
      expiresAt: new Date(
        Date.now() + PASSWORD_RESET_EXPIRES_MINUTES * 60_000
      ),
    },
  });
  return siteUrl(`/reset-password?token=${raw}`);
}

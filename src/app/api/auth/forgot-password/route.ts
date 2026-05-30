import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { sendPasswordReset } from "@/lib/email";
import { siteUrl } from "@/lib/site-url";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const EXPIRES_MINUTES = 60;

export const runtime = "nodejs";

export async function POST(req: Request) {
  // IP burst cap, then per-email cap. Both swallow into a generic 200
  // response so we don't tell a bot that a known email is being throttled.
  const ipLimit = await rateLimit("register", clientIp(req));
  if (!ipLimit.allowed) return NextResponse.json({ ok: true });
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").toLowerCase().trim();
  if (email) {
    const emailLimit = await rateLimit("forgot", email);
    if (!emailLimit.allowed) return NextResponse.json({ ok: true });
  }

  if (email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const raw = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto
        .createHash("sha256")
        .update(raw)
        .digest("hex");
      await prisma.passwordResetToken.create({
        data: {
          tokenHash,
          userId: user.id,
          expiresAt: new Date(Date.now() + EXPIRES_MINUTES * 60_000),
        },
      });
      const url = siteUrl(`/reset-password?token=${raw}`);
      await sendPasswordReset({
        to: user.email,
        name: user.name,
        resetUrl: url,
        expiresMinutes: EXPIRES_MINUTES,
      });
    }
  }

  // Always return ok so the response shape doesn't reveal whether the email
  // exists. Mitigates account enumeration.
  return NextResponse.json({ ok: true });
}

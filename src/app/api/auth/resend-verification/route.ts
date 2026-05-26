import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { issueEmailVerification } from "@/lib/email-verification";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Resend the verification email to the address on the signed-in user's
 * account. Rate-limited at the helper layer (60-second cooldown per user)
 * so this endpoint is safe to hammer.
 */
export async function POST(req: Request) {
  const limit = await rateLimit("generic", clientIp(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  if (user.emailVerified) {
    return NextResponse.json({
      ok: true,
      alreadyVerified: true,
    });
  }
  const result = await issueEmailVerification({
    userId: user.id,
    email: user.email,
    name: user.name,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: `Wait ${Math.ceil(result.cooldownMs / 1000)} seconds before resending.`,
        cooldownMs: result.cooldownMs,
      },
      { status: 429 }
    );
  }
  return NextResponse.json({ ok: true });
}

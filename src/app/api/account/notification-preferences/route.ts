import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * PLH-2 Phase 4d (D1): user-controlled non-transactional email opt-outs.
 * Auth-gated and rate-limited. Transactional mail bypasses these flags.
 */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const rl = await rateLimit("generic", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }
  const body = await req.json().catch(() => ({}));
  const data: {
    notifyOrderEmails?: boolean;
    notifyMarketingEmails?: boolean;
    notifyProductUpdates?: boolean;
  } = {};
  if (typeof body.notifyOrderEmails === "boolean") {
    data.notifyOrderEmails = body.notifyOrderEmails;
  }
  if (typeof body.notifyMarketingEmails === "boolean") {
    data.notifyMarketingEmails = body.notifyMarketingEmails;
  }
  if (typeof body.notifyProductUpdates === "boolean") {
    data.notifyProductUpdates = body.notifyProductUpdates;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No valid preference fields supplied." },
      { status: 400 }
    );
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
    select: {
      notifyOrderEmails: true,
      notifyMarketingEmails: true,
      notifyProductUpdates: true,
    },
  });
  return NextResponse.json({ ok: true, preferences: updated });
}

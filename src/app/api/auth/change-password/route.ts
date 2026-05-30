import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  createSession,
  getCurrentUser,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

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
  const body = await req.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");

  if (newPassword.length < 8 || newPassword.length > 128) {
    return NextResponse.json(
      { error: "New password must be between 8 and 128 characters." },
      { status: 400 }
    );
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: "New password must be different from the current one." },
      { status: 400 }
    );
  }

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 400 }
    );
  }

  // PLH-1: bump sessionsValidFrom so every other browser this user is
  // signed into on gets rejected on the next request.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      sessionsValidFrom: new Date(),
    },
  });

  // Invalidate any outstanding password-reset tokens for safety.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  // Re-issue a fresh session cookie for the browser that just changed the
  // password. The sessionsValidFrom bump above already invalidated every
  // other outstanding session; this keeps the active tab signed in.
  await createSession(user.id);

  return NextResponse.json({ ok: true });
}

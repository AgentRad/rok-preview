import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  const newPassword = String(body.password || "");

  if (!token || newPassword.length < 8) {
    return NextResponse.json(
      { error: "Please enter a password of at least 8 characters." },
      { status: 400 }
    );
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired. Please request a new one." },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    // Invalidate other outstanding tokens for this user.
    prisma.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null, id: { not: record.id } },
      data: { usedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ ok: true });
}

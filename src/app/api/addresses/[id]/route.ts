import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

async function ownedAddress(userId: string, id: string) {
  return prisma.address.findFirst({ where: { id, userId } });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  // PLH-2 Phase 4d (D2): per-user throttle on address mutations.
  const rl = await rateLimit("generic", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }
  const { id } = await params;
  const existing = await ownedAddress(user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "Address not found." }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  if (body.action === "set-default") {
    await prisma.$transaction([
      prisma.address.updateMany({
        where: { userId: user.id, isDefault: true },
        data: { isDefault: false },
      }),
      prisma.address.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  // PLH-2 Phase 4d (D2): per-user throttle on address mutations.
  const rl = await rateLimit("generic", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }
  const { id } = await params;
  const existing = await ownedAddress(user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "Address not found." }, { status: 404 });
  }
  await prisma.address.delete({ where: { id } });
  if (existing.isDefault) {
    const next = await prisma.address.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    if (next) {
      await prisma.address.update({
        where: { id: next.id },
        data: { isDefault: true },
      });
    }
  }
  return NextResponse.json({ ok: true });
}

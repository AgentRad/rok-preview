import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

async function ownedAddress(userId: string, id: string) {
  // PLH-3j P2: filter soft-deleted rows so a deleted address cannot be
  // re-edited or re-deleted from any address-book mutation route.
  return prisma.address.findFirst({ where: { id, userId, deletedAt: null } });
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
  // PLH-3j P2: soft-delete. Historical Orders that snapshotted the
  // ship-to from this Address keep their reference (no FK breakage,
  // no denorm loss). Reads filter deletedAt = null so the row no
  // longer shows up in the buyer's address book.
  await prisma.$transaction(async (tx) => {
    await tx.address.update({
      where: { id },
      data: { deletedAt: new Date(), isDefault: false },
    });
    if (existing.isDefault) {
      const next = await tx.address.findFirst({
        where: { userId: user.id, deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      if (next) {
        await tx.address.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }
  });
  await writeAuditLog({
    actor: { id: user.id, email: user.email },
    action: "ADDRESS_SOFT_DELETED",
    targetType: "Address",
    targetId: id,
    summary: `User soft-deleted address ${id}`,
  });
  return NextResponse.json({ ok: true });
}

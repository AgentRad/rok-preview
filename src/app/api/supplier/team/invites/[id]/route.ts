import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canManageTeam,
  getSupplierContextForUser,
} from "@/lib/supplier-access";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const ctx = await getSupplierContextForUser(user.id);
  if (!ctx || !canManageTeam(ctx.role)) {
    return NextResponse.json({ error: "Only the owner can cancel invites." }, { status: 403 });
  }
  const { id } = await params;
  const invite = await prisma.supplierInvite.findUnique({ where: { id } });
  if (!invite || invite.supplierId !== ctx.supplier.id) {
    return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  }
  await prisma.supplierInvite.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

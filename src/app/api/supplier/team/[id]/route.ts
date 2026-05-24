import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canManageTeam,
  getSupplierContextForUser,
} from "@/lib/supplier-access";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const ctx = await getSupplierContextForUser(user.id);
  if (!ctx || !canManageTeam(ctx.role)) {
    return NextResponse.json({ error: "Only the owner can change roles." }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const role = body.role === "OWNER" ? "OWNER" : "MEMBER";

  const member = await prisma.supplierMember.findUnique({ where: { id } });
  if (!member || member.supplierId !== ctx.supplier.id) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }
  // Refuse to demote the last OWNER. There must always be at least one owner.
  if (member.role === "OWNER" && role !== "OWNER") {
    const ownerCount = await prisma.supplierMember.count({
      where: { supplierId: ctx.supplier.id, role: "OWNER" },
    });
    if (ownerCount <= 1) {
      return NextResponse.json(
        { error: "Promote another member to owner before demoting yourself." },
        { status: 400 }
      );
    }
  }
  await prisma.supplierMember.update({ where: { id }, data: { role } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const ctx = await getSupplierContextForUser(user.id);
  if (!ctx || !canManageTeam(ctx.role)) {
    return NextResponse.json({ error: "Only the owner can remove members." }, { status: 403 });
  }
  const { id } = await params;
  const member = await prisma.supplierMember.findUnique({ where: { id } });
  if (!member || member.supplierId !== ctx.supplier.id) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }
  if (member.role === "OWNER") {
    const ownerCount = await prisma.supplierMember.count({
      where: { supplierId: ctx.supplier.id, role: "OWNER" },
    });
    if (ownerCount <= 1) {
      return NextResponse.json(
        { error: "Cannot remove the last owner of the supplier." },
        { status: 400 }
      );
    }
  }
  await prisma.supplierMember.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

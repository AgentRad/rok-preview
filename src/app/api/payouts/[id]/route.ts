import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  const payout = await prisma.payout.findUnique({ where: { id } });
  if (!payout) {
    return NextResponse.json({ error: "Payout not found." }, { status: 404 });
  }

  if (action === "mark-paid") {
    if (payout.status === "PAID") return NextResponse.json({ ok: true });
    await prisma.payout.update({
      where: { id },
      data: { status: "PAID", paidAt: new Date(), note: String(body.note || "").trim() || payout.note },
    });
    return NextResponse.json({ ok: true });
  }
  if (action === "mark-due") {
    await prisma.payout.update({
      where: { id },
      data: { status: "DUE", paidAt: null },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

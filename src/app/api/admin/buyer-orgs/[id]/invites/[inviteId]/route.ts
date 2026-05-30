import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** PLH-3y-1: admin cancels a pending buyer org invite. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; inviteId: string }> }
) {
  const admin = await getCurrentUser();
  if (!admin || admin.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const rl = await rateLimit("generic", `user:${admin.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { id: buyerOrgId, inviteId } = await params;
  const invite = await prisma.buyerOrgInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.buyerOrgId !== buyerOrgId) {
    return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  }
  await prisma.buyerOrgInvite.delete({ where: { id: inviteId } });
  return NextResponse.json({ ok: true });
}

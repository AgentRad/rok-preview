import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

/** PLH-3y-1: admin removes a member from a buyer org. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const admin = await getCurrentUser();
  if (!admin || admin.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const rl = await rateLimit("generic", `user:${admin.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { id: buyerOrgId, memberId } = await params;
  const member = await prisma.buyerOrgMember.findUnique({
    where: { id: memberId },
    include: { user: { select: { email: true } } },
  });
  if (!member || member.buyerOrgId !== buyerOrgId) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.buyerOrgMember.delete({ where: { id: memberId } }),
    // Clear the dropped member's active-org pointer if it pointed here.
    prisma.user.updateMany({
      where: { id: member.userId, activeBuyerOrgId: buyerOrgId },
      data: { activeBuyerOrgId: null },
    }),
  ]);

  await writeAuditLog({
    actor: admin,
    action: "BUYER_ORG_MEMBER_REMOVED",
    targetType: "BuyerOrg",
    targetId: buyerOrgId,
    summary: `Removed ${member.user.email} from the organization`,
    metadata: { userId: member.userId },
  });

  return NextResponse.json({ ok: true });
}

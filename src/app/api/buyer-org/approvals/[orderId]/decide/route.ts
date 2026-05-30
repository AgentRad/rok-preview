import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getActiveBuyerOrgContext, canApproveOrders } from "@/lib/buyer-org-access";
import { advanceApproval } from "@/lib/approval";

export const runtime = "nodejs";

/**
 * PLH-3y-6 C3: single-step approve or reject from the approver queue.
 * Body: { decision: "APPROVE" | "REJECT", reason?: string }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  const user = await requireUser();
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx || !canApproveOrders(ctx.role)) {
    return NextResponse.json({ error: "Not authorized to approve orders." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const decision: string = String(body.decision || "").trim().toUpperCase();
  if (decision !== "APPROVE" && decision !== "REJECT") {
    return NextResponse.json({ error: "decision must be APPROVE or REJECT." }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

  // Look up the decider's BuyerOrgMember id.
  const { prisma } = await import("@/lib/db");
  const member = await prisma.buyerOrgMember.findUnique({
    where: { buyerOrgId_userId: { buyerOrgId: ctx.org.id, userId: user.id } },
    select: { id: true },
  });
  if (!member) {
    return NextResponse.json({ error: "Not a member of this org." }, { status: 403 });
  }

  const result = await advanceApproval({
    orderId,
    deciderMemberId: member.id,
    decision: decision as "APPROVE" | "REJECT",
    reason,
  });

  if (result && typeof result === "object" && "error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  if (!result) {
    return NextResponse.json(
      { error: "Could not process this decision. The step may already be resolved or you are not the assigned approver." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, approvalStatus: result });
}

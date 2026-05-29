import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getActiveBuyerOrgContext, canApproveOrders } from "@/lib/buyer-org-access";
import { delegateApprovalGuard } from "@/lib/route-guards";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * PLH-3y-6 C5: set or clear out-of-office delegation for the calling member.
 * PATCH body: { oooUntil: string | null, delegateToMemberId: string | null }
 *
 * oooUntil: ISO date string (future date) or null to clear.
 * delegateToMemberId: another BuyerOrgMember in the same org, or null.
 * Both must be set together; clearing either one clears both.
 */
export async function PATCH(req: Request) {
  const user = await requireUser();
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx) {
    return NextResponse.json({ error: "No active org." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  const rawOooUntil = body.oooUntil;
  const delegateToMemberId =
    typeof body.delegateToMemberId === "string"
      ? body.delegateToMemberId.trim() || null
      : null;

  let oooUntil: Date | null = null;
  if (rawOooUntil) {
    const d = new Date(rawOooUntil);
    if (isNaN(d.getTime()) || d <= new Date()) {
      return NextResponse.json({ error: "oooUntil must be a future date." }, { status: 400 });
    }
    oooUntil = d;
  }

  // Both must be set together when enabling.
  if ((oooUntil !== null) !== (delegateToMemberId !== null)) {
    return NextResponse.json(
      { error: "oooUntil and delegateToMemberId must both be set or both be null." },
      { status: 400 }
    );
  }

  if (delegateToMemberId) {
    // Verify the delegate is in the same org and is not the caller.
    const delegate = await prisma.buyerOrgMember.findUnique({
      where: { id: delegateToMemberId },
      select: { buyerOrgId: true, role: true },
    });
    if (!delegate || delegate.buyerOrgId !== ctx.org.id) {
      return NextResponse.json({ error: "Delegate must be a member of the same org." }, { status: 400 });
    }
    // The delegate inherits the caller's pending approvals, and advanceApproval
    // authorizes whoever is assigned. So the delegate MUST be able to approve
    // orders (APPROVER or ADMIN); delegating to a VIEWER/BUYER would escalate a
    // read-only member past canApproveOrders.
    const roleCheck = delegateApprovalGuard({ delegateCanApprove: canApproveOrders(delegate.role) });
    if (!roleCheck.ok) {
      return NextResponse.json({ error: roleCheck.error }, { status: roleCheck.status });
    }
    const self = await prisma.buyerOrgMember.findUnique({
      where: { buyerOrgId_userId: { buyerOrgId: ctx.org.id, userId: user.id } },
      select: { id: true },
    });
    if (self?.id === delegateToMemberId) {
      return NextResponse.json({ error: "Cannot delegate to yourself." }, { status: 400 });
    }
  }

  await prisma.buyerOrgMember.update({
    where: { buyerOrgId_userId: { buyerOrgId: ctx.org.id, userId: user.id } },
    data: { oooUntil, delegateToMemberId },
  });

  await writeAuditLog({
    actor: { id: user.id, email: user.email },
    action: "APPROVAL_DELEGATION_UPDATED",
    targetType: "BuyerOrg",
    targetId: ctx.org.id,
    summary: oooUntil
      ? `OOO delegation set until ${oooUntil.toISOString()} to member ${delegateToMemberId}.`
      : "OOO delegation cleared.",
    metadata: { oooUntil, delegateToMemberId },
  });

  return NextResponse.json({ ok: true });
}

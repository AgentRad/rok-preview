import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getActiveBuyerOrgContext, canManageApprovalRules } from "@/lib/buyer-org-access";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * PLH-3y-6 C6: approval rule CRUD.
 * PATCH /api/buyer-org/approval-rules/[id] - update a rule
 * DELETE /api/buyer-org/approval-rules/[id] - delete a rule
 */

async function getRule(ruleId: string, orgId: string) {
  return prisma.approvalRule.findFirst({
    where: { id: ruleId, buyerOrgId: orgId },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireUser();
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx || !canManageApprovalRules(ctx.role)) {
    return NextResponse.json({ error: "Org ADMIN only." }, { status: 403 });
  }

  const rule = await getRule(id, ctx.org.id);
  if (!rule) return NextResponse.json({ error: "Rule not found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  const updated = await prisma.approvalRule.update({
    where: { id },
    data: {
      name: typeof body.name === "string" ? body.name.trim().slice(0, 120) || rule.name : undefined,
      minTotalCents: "minTotalCents" in body ? (typeof body.minTotalCents === "number" ? Math.max(0, Math.floor(body.minTotalCents)) : null) : undefined,
      maxTotalCents: "maxTotalCents" in body ? (typeof body.maxTotalCents === "number" ? Math.max(0, Math.floor(body.maxTotalCents)) : null) : undefined,
      supplierId: "supplierId" in body ? (typeof body.supplierId === "string" ? body.supplierId.trim() || null : null) : undefined,
      approverMemberId: "approverMemberId" in body ? (typeof body.approverMemberId === "string" ? body.approverMemberId.trim() || null : null) : undefined,
      approverRole: "approverRole" in body ? (typeof body.approverRole === "string" ? (body.approverRole as "ADMIN" | "APPROVER" | "BUYER" | "VIEWER") || null : null) : undefined,
      chainGroup: "chainGroup" in body ? (typeof body.chainGroup === "string" ? body.chainGroup.trim() || null : null) : undefined,
      chainOrder: typeof body.chainOrder === "number" ? Math.max(0, Math.floor(body.chainOrder)) : undefined,
      escalateAfterHours: "escalateAfterHours" in body ? (typeof body.escalateAfterHours === "number" ? Math.max(1, Math.floor(body.escalateAfterHours)) : null) : undefined,
      escalateToMemberId: "escalateToMemberId" in body ? (typeof body.escalateToMemberId === "string" ? body.escalateToMemberId.trim() || null : null) : undefined,
      autoApproveIfHistoricalMatch: typeof body.autoApproveIfHistoricalMatch === "boolean" ? body.autoApproveIfHistoricalMatch : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    },
  });

  await writeAuditLog({
    actor: { id: user.id, email: user.email },
    action: "APPROVAL_RULE_UPDATED",
    targetType: "ApprovalRule",
    targetId: id,
    summary: `Approval rule "${updated.name}" updated.`,
    metadata: { ruleId: id, orgId: ctx.org.id },
  });

  return NextResponse.json({ rule: updated });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  void req;
  const { id } = await params;
  const user = await requireUser();
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx || !canManageApprovalRules(ctx.role)) {
    return NextResponse.json({ error: "Org ADMIN only." }, { status: 403 });
  }

  const rule = await getRule(id, ctx.org.id);
  if (!rule) return NextResponse.json({ error: "Rule not found." }, { status: 404 });

  await prisma.approvalRule.delete({ where: { id } });

  await writeAuditLog({
    actor: { id: user.id, email: user.email },
    action: "APPROVAL_RULE_DELETED",
    targetType: "ApprovalRule",
    targetId: id,
    summary: `Approval rule "${rule.name}" deleted.`,
    metadata: { ruleId: id, orgId: ctx.org.id },
  });

  return NextResponse.json({ ok: true });
}

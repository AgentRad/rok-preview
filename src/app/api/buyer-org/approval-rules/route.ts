import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getActiveBuyerOrgContext, canManageApprovalRules } from "@/lib/buyer-org-access";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * PLH-3y-6 C6: approval rule CRUD for org ADMINs.
 * GET  /api/buyer-org/approval-rules        - list rules for active org
 * POST /api/buyer-org/approval-rules        - create a new rule
 */

export async function GET(req: Request) {
  void req;
  const user = await requireUser();
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx) return NextResponse.json({ error: "No active org." }, { status: 403 });

  const rules = await prisma.approvalRule.findMany({
    where: { buyerOrgId: ctx.org.id },
    orderBy: [{ chainGroup: "asc" }, { chainOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ rules });
}

export async function POST(req: Request) {
  const user = await requireUser();
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx || !canManageApprovalRules(ctx.role)) {
    return NextResponse.json({ error: "Org ADMIN only." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "name is required." }, { status: 400 });

  const rule = await prisma.approvalRule.create({
    data: {
      buyerOrgId: ctx.org.id,
      name,
      minTotalCents: typeof body.minTotalCents === "number" ? Math.max(0, Math.floor(body.minTotalCents)) : null,
      maxTotalCents: typeof body.maxTotalCents === "number" ? Math.max(0, Math.floor(body.maxTotalCents)) : null,
      supplierId: typeof body.supplierId === "string" ? body.supplierId.trim() || null : null,
      approverMemberId: typeof body.approverMemberId === "string" ? body.approverMemberId.trim() || null : null,
      approverRole: typeof body.approverRole === "string" ? (body.approverRole as "ADMIN" | "APPROVER" | "BUYER" | "VIEWER") || null : null,
      chainGroup: typeof body.chainGroup === "string" ? body.chainGroup.trim() || null : null,
      chainOrder: typeof body.chainOrder === "number" ? Math.max(0, Math.floor(body.chainOrder)) : 0,
      escalateAfterHours: typeof body.escalateAfterHours === "number" ? Math.max(1, Math.floor(body.escalateAfterHours)) : null,
      escalateToMemberId: typeof body.escalateToMemberId === "string" ? body.escalateToMemberId.trim() || null : null,
      autoApproveIfHistoricalMatch: body.autoApproveIfHistoricalMatch === true,
      enabled: body.enabled !== false,
    },
  });

  await writeAuditLog({
    actor: { id: user.id, email: user.email },
    action: "APPROVAL_RULE_CREATED",
    targetType: "ApprovalRule",
    targetId: rule.id,
    summary: `Approval rule "${name}" created for ${ctx.org.name}.`,
    metadata: { ruleId: rule.id, orgId: ctx.org.id },
  });

  return NextResponse.json({ rule }, { status: 201 });
}

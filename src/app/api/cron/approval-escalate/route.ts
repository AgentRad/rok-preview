import "server-only";
import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { prisma } from "@/lib/db";
import { captureError } from "@/lib/observability";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

const MAX_PER_RUN = 100;

/**
 * PLH-3y-6 C5: escalate approval steps that have been PENDING longer than
 * the rule's escalateAfterHours. Walks PENDING OrderApproval rows in ASC
 * order, checks the owning rule's escalateAfterHours and escalateToMemberId,
 * and either reassigns the step or logs APPROVAL_ESCALATED + fires an email.
 *
 * Scheduled twice per hour (8:00 + 8:30 UTC) via two vercel.json entries.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();
  let processed = 0;
  let escalated = 0;
  let errors = 0;

  // Fetch pending steps with their rules and order detail.
  const pendingSteps = await prisma.orderApproval.findMany({
    where: { outcome: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: MAX_PER_RUN + 1,
    include: {
      order: {
        select: {
          id: true,
          buyerOrgId: true,
          buyerName: true,
          buyerEmail: true,
          reference: true,
          totalCents: true,
          approvalStatus: true,
        },
      },
    },
  });

  const hasMore = pendingSteps.length > MAX_PER_RUN;
  const slice = hasMore ? pendingSteps.slice(0, MAX_PER_RUN) : pendingSteps;

  for (const step of slice) {
    processed++;
    try {
      // Skip if the order is no longer in a pending approval state (e.g.
      // it was resolved between when we fetched and now).
      if (step.order.approvalStatus !== "PENDING") continue;

      // Load the rule to check escalation config.
      if (!step.ruleId) continue;
      const rule = await prisma.approvalRule.findUnique({
        where: { id: step.ruleId },
        select: { escalateAfterHours: true, escalateToMemberId: true },
      });
      if (!rule?.escalateAfterHours || !rule.escalateToMemberId) continue;

      // Check if the step has been open longer than escalateAfterHours.
      const ageMs = now.getTime() - step.createdAt.getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      if (ageHours < rule.escalateAfterHours) continue;

      // Already escalated to this member? Skip to avoid repeated emails.
      if (step.approverMemberId === rule.escalateToMemberId) continue;

      // Resolve the original approver's name for the email.
      const originalMember = step.approverMemberId
        ? await prisma.buyerOrgMember.findUnique({
            where: { id: step.approverMemberId },
            include: { user: { select: { name: true, email: true } } },
          })
        : null;
      const escalateMember = await prisma.buyerOrgMember.findUnique({
        where: { id: rule.escalateToMemberId },
        include: { user: { select: { name: true, email: true } } },
      });
      if (!escalateMember?.user) continue;

      // Reassign the step to the escalation target.
      await prisma.orderApproval.update({
        where: { id: step.id },
        data: { approverMemberId: rule.escalateToMemberId },
      });

      await writeAuditLog({
        actor: { id: "cron", email: "cron@partsport.internal" },
        action: "APPROVAL_ESCALATED",
        targetType: "Order",
        targetId: step.order.id,
        summary: `Approval step escalated after ${rule.escalateAfterHours}h. New approver: ${escalateMember.user.email}.`,
        metadata: {
          stepId: step.id,
          fromMemberId: step.approverMemberId,
          toMemberId: rule.escalateToMemberId,
          escalateAfterHours: rule.escalateAfterHours,
        },
      });

      // Fire escalation email.
      try {
        const { approvalActionUrl } = await import("@/lib/approval-token");
        const { sendApprovalEscalated } = await import("@/lib/email");
        await sendApprovalEscalated({
          to: escalateMember.user.email,
          escalateName: escalateMember.user.name || escalateMember.user.email,
          buyerName: step.order.buyerName,
          orgName: "",
          orderReference: step.order.reference,
          orderId: step.order.id,
          totalCents: step.order.totalCents,
          approveUrl: approvalActionUrl(step.order.id, rule.escalateToMemberId, "approve"),
          rejectUrl: approvalActionUrl(step.order.id, rule.escalateToMemberId, "reject"),
          originalApproverName: originalMember?.user?.name || originalMember?.user?.email || "the original approver",
        });
      } catch (emailErr) {
        captureError(emailErr, { subsystem: "approval", op: "escalate-email", orderId: step.order.id });
      }

      escalated++;
    } catch (err) {
      errors++;
      captureError(err, { subsystem: "approval-escalate-cron", stepId: step.id });
    }
  }

  return NextResponse.json({ ok: true, processed, escalated, errors, hasMore });
}

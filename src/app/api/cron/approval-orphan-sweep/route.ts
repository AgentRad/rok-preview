import "server-only";
import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { prisma } from "@/lib/db";
import { captureError } from "@/lib/observability";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

const MAX_PER_RUN = 100;
// An order is considered orphaned when it has been in PENDING approval for
// more than 48 hours with no active approver assigned on the pending step.
const ORPHAN_HOURS = 48;

/**
 * PLH-3y-6 C5: sweep approval-orphaned orders. An order is orphaned when
 * its active OrderApproval step has no approverMemberId (the org may have
 * changed rules after the order was created, or the originally assigned
 * member was removed from the org). This cron finds such steps and
 * reassigns them to the first ADMIN of the org, auditing
 * APPROVAL_ORPHANED_REASSIGNED so the admin knows to act.
 *
 * Scheduled daily at 07:30 UTC.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - ORPHAN_HOURS * 60 * 60 * 1000);
  let processed = 0;
  let reassigned = 0;
  let errors = 0;

  const orphaned = await prisma.orderApproval.findMany({
    where: {
      outcome: "PENDING",
      approverMemberId: null,
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_PER_RUN + 1,
    include: {
      order: {
        select: {
          id: true,
          buyerOrgId: true,
          reference: true,
          approvalStatus: true,
        },
      },
    },
  });

  const hasMore = orphaned.length > MAX_PER_RUN;
  const slice = hasMore ? orphaned.slice(0, MAX_PER_RUN) : orphaned;

  for (const step of slice) {
    processed++;
    try {
      if (!step.order.buyerOrgId) continue;
      if (step.order.approvalStatus !== "PENDING") continue;

      // Find the first ADMIN of the org to reassign to.
      const admin = await prisma.buyerOrgMember.findFirst({
        where: { buyerOrgId: step.order.buyerOrgId, role: "ADMIN" },
        orderBy: { joinedAt: "asc" },
        select: { id: true },
      });
      if (!admin) continue;

      await prisma.orderApproval.update({
        where: { id: step.id },
        data: { approverMemberId: admin.id },
      });

      await writeAuditLog({
        actor: { id: "cron", email: "cron@partsport.internal" },
        action: "APPROVAL_ORPHANED_REASSIGNED",
        targetType: "Order",
        targetId: step.order.id,
        summary: `Orphaned approval step reassigned to org ADMIN after ${ORPHAN_HOURS}h with no approver.`,
        metadata: { stepId: step.id, newApproverMemberId: admin.id },
      });

      reassigned++;
    } catch (err) {
      errors++;
      captureError(err, { subsystem: "approval-orphan-sweep", stepId: step.id });
    }
  }

  return NextResponse.json({ ok: true, processed, reassigned, errors, hasMore });
}

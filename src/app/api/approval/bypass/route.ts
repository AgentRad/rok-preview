import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";
import { after } from "next/server";

export const runtime = "nodejs";

/**
 * PLH-3y-6 C5: emergency approval bypass. Site admin only.
 * Immediately moves the order from PENDING to APPROVED (or AUTO_APPROVED
 * semantically, but stored as BYPASSED) so the buyer can pay.
 * Body: { orderId: string, reason?: string }
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "Site admin only." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId || "").trim();
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "Emergency bypass by admin.";

  if (!orderId) {
    return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      approvalStatus: true,
      buyerName: true,
      buyerEmail: true,
      reference: true,
      totalCents: true,
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (order.approvalStatus !== "PENDING") {
    return NextResponse.json({ error: "Order is not in PENDING approval state." }, { status: 400 });
  }

  // Resolve or create the admin's BuyerOrgMember record for audit.
  // For bypass we don't need a member record; just use the admin user id.

  await prisma.$transaction([
    // Close any active PENDING step.
    prisma.orderApproval.updateMany({
      where: { orderId, outcome: "PENDING" },
      data: {
        outcome: "APPROVED",
        approverMemberId: null,
        reason: reason,
        decidedAt: new Date(),
      },
    }),
    prisma.order.update({
      where: { id: orderId },
      data: { approvalStatus: "BYPASSED" },
    }),
  ]);

  await writeAuditLog({
    actor: { id: user.id, email: user.email },
    action: "EMERGENCY_APPROVAL_BYPASS",
    targetType: "Order",
    targetId: orderId,
    summary: `Emergency bypass: ${reason}`,
    metadata: { reason, adminId: user.id },
  });

  // Notify the buyer.
  after(async () => {
    try {
      const { sendApprovalBypassed } = await import("@/lib/email");
      await sendApprovalBypassed({
        to: order.buyerEmail,
        buyerName: order.buyerName,
        orderReference: order.reference,
        orderId: order.id,
        totalCents: order.totalCents,
        adminName: user.name || user.email,
      });
    } catch (emailErr) {
      captureError(emailErr, { subsystem: "approval", op: "bypass-email", orderId });
    }
  });

  return NextResponse.json({ ok: true, approvalStatus: "BYPASSED" });
}

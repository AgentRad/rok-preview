import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { after } from "next/server";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * PLH-3y-6 C5: buyer pokes the approver with a reminder email.
 * Rate-limited to 1 poke per order per 24h.
 * Body: { orderId: string }
 */
export async function POST(req: Request) {
  const user = await requireUser();

  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId || "").trim();
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  }

  // Rate-limit: 1 poke per order per 24h.
  const rl = await rateLimit("generic", `approval-poke:${orderId}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "A reminder was already sent recently. Please wait before poking again." },
      { status: 429 }
    );
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      buyerId: true,
      buyerOrgId: true,
      approvalStatus: true,
      reference: true,
      totalCents: true,
      buyerName: true,
      buyerEmail: true,
    },
  });

  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.buyerId !== user.id && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (order.approvalStatus !== "PENDING") {
    return NextResponse.json({ error: "Order is not awaiting approval." }, { status: 400 });
  }

  const pendingStep = await prisma.orderApproval.findFirst({
    where: { orderId, outcome: "PENDING" },
    select: { id: true, approverMemberId: true },
  });

  if (!pendingStep?.approverMemberId) {
    return NextResponse.json({ ok: true, sent: false, reason: "No assigned approver." });
  }

  const approverUser = await prisma.buyerOrgMember.findUnique({
    where: { id: pendingStep.approverMemberId },
    include: { user: { select: { email: true, name: true } } },
  });

  if (!approverUser?.user) {
    return NextResponse.json({ ok: true, sent: false, reason: "Approver not found." });
  }

  await writeAuditLog({
    actor: { id: user.id, email: user.email },
    action: "APPROVAL_POKED",
    targetType: "Order",
    targetId: orderId,
    summary: `Buyer poked approver ${approverUser.user.email}.`,
    metadata: { stepId: pendingStep.id },
  });

  after(async () => {
    try {
      const { approvalActionUrl } = await import("@/lib/approval-token");
      const { sendApprovalRequested } = await import("@/lib/email");
      const approver = approverUser.user!;
      await sendApprovalRequested({
        to: approver.email,
        approverName: approver.name || approver.email,
        buyerName: order.buyerName,
        orgName: "",
        orderReference: order.reference,
        orderId: order.id,
        totalCents: order.totalCents,
        approveUrl: approvalActionUrl(order.id, pendingStep.approverMemberId!, "approve"),
        rejectUrl: approvalActionUrl(order.id, pendingStep.approverMemberId!, "reject"),
      });
    } catch (emailErr) {
      captureError(emailErr, { subsystem: "approval", op: "poke-email", orderId });
    }
  });

  return NextResponse.json({ ok: true, sent: true });
}

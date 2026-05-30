import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog, type AuditAction } from "@/lib/audit";
import { refundOrder } from "@/lib/refunds";
import {
  sendReturnApproved,
  sendReturnRejected,
  sendReturnResolved,
  sendReturnNotifySupplier,
} from "@/lib/email";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

const ACTIONS = ["approve", "reject", "resolve"] as const;
type Action = (typeof ACTIONS)[number];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body.action as Action | undefined;
  if (!action || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  const note = String(body.note || "").trim().slice(0, 4000);

  const r = await prisma.returnRequest.findUnique({
    where: { id },
    include: {
      order: {
        include: {
          items: { include: { product: { include: { supplier: true } } } },
        },
      },
    },
  });
  if (!r) {
    return NextResponse.json({ error: "Return not found." }, { status: 404 });
  }

  // Polish 12 H5: approving a return must move money. Admin POSTs an
  // explicit refund amount (defaulting in the UI to order total minus
  // already-refunded). 400 if missing/invalid; refundOrder takes care
  // of the Stripe call + Refund row + supplier clawback.
  let refundedCents = 0;
  if (action === "approve") {
    const remaining = r.order.totalCents - r.order.refundedCents;
    const amount = Math.floor(Number(body.amountCents));
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        {
          error: `Refund amount is required (positive cents, up to ${remaining}).`,
        },
        { status: 400 }
      );
    }
    if (amount > remaining) {
      return NextResponse.json(
        { error: `Refund exceeds remaining ${remaining} cents on this order.` },
        { status: 400 }
      );
    }
    const result = await refundOrder({
      orderId: r.orderId,
      amountCents: amount,
      reason: `Return ${r.reference}: ${r.reason}${note ? ` (${note})` : ""}`,
      returnRequestId: r.id,
      refundedByUserId: user.id,
      refundedByEmail: user.email,
      manualOverride: body.manualOverride === true,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    refundedCents = amount;
  }

  const statusMap: Record<Action, "APPROVED" | "REJECTED" | "RESOLVED"> = {
    approve: "APPROVED",
    reject: "REJECTED",
    resolve: "RESOLVED",
  };

  const updated = await prisma.returnRequest.update({
    where: { id },
    data: {
      status: statusMap[action],
      adminNote: note || r.adminNote,
      resolvedAt: action === "resolve" ? new Date() : r.resolvedAt,
    },
  });

  const auditAction: AuditAction =
    action === "approve"
      ? "RETURN_APPROVED"
      : action === "reject"
        ? "RETURN_REJECTED"
        : "RETURN_RESOLVED";
  await writeAuditLog({
    actor: user,
    action: auditAction,
    targetType: "ReturnRequest",
    targetId: updated.id,
    summary: `Return ${updated.reference} ${statusMap[action].toLowerCase()}${refundedCents > 0 ? ` (refunded ${refundedCents} cents)` : ""}${note ? `: ${note}` : ""}`,
    metadata: {
      orderId: updated.orderId,
      reason: updated.reason,
      refundedCents,
    },
  });

  // H6: notify the buyer + supplier.
  const buyerEmail = r.order.buyerEmail;
  const supplierEmail =
    r.order.items[0]?.product?.supplier?.contactEmail || null;
  after(async () => {
    try {
      if (action === "approve") {
        await sendReturnApproved({
          to: buyerEmail,
          buyerName: r.order.buyerName,
          orderReference: r.order.reference,
          returnReference: r.reference,
          reason: r.reason,
          note: note || undefined,
          amountCents: refundedCents || undefined,
        });
      } else if (action === "reject") {
        await sendReturnRejected({
          to: buyerEmail,
          buyerName: r.order.buyerName,
          orderReference: r.order.reference,
          returnReference: r.reference,
          reason: r.reason,
          note: note || undefined,
        });
      } else {
        await sendReturnResolved({
          to: buyerEmail,
          buyerName: r.order.buyerName,
          orderReference: r.order.reference,
          returnReference: r.reference,
          reason: r.reason,
          note: note || undefined,
        });
      }
      if (supplierEmail) {
        await sendReturnNotifySupplier({
          to: supplierEmail,
          supplierName: r.order.items[0]?.product?.supplier?.name || "your team",
          orderReference: r.order.reference,
          returnReference: r.reference,
          status: statusMap[action],
          reason: r.reason,
          note: note || undefined,
        });
      }
    } catch (err) {
      captureError(err, {
        subsystem: "email",
        op: "return-notify",
        returnId: updated.id,
      });
    }
  });

  return NextResponse.json({ ok: true, refundedCents });
}

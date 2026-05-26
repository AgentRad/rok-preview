import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { refundOrder } from "@/lib/refunds";
import { sendOrderRefunded } from "@/lib/email";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * Admin-triggered refund. Body:
 *   amountCents   - positive integer, capped at totalCents - refundedCents
 *   reason        - human readable; mapped to Stripe's reason enum
 *   returnRequestId? - links the refund back to the RMA when applicable
 *
 * Side effects:
 *   - Stripe refunds.create (or no-op when Stripe isn't configured)
 *   - Refund row created
 *   - Order.refundedCents bumped; flips Order.status to REFUNDED on full
 *   - Supplier reserve drawn down for the supplier's share
 *   - Audit log entry written
 *   - Confirmation email queued via after()
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const amountCents = Math.floor(Number(body.amountCents || 0));
  const reason = String(body.reason || "").trim().slice(0, 500);
  const returnRequestId = body.returnRequestId
    ? String(body.returnRequestId)
    : undefined;
  if (!amountCents || amountCents <= 0) {
    return NextResponse.json(
      { error: "amountCents must be a positive integer." },
      { status: 400 }
    );
  }
  if (!reason) {
    return NextResponse.json(
      { error: "Provide a reason so the buyer email and audit log are useful." },
      { status: 400 }
    );
  }

  const result = await refundOrder({
    orderId: id,
    amountCents,
    reason,
    returnRequestId,
    refundedByUserId: user.id,
    refundedByEmail: user.email,
    manualOverride: body.manualOverride === true,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // P9.5 HIGH 14: dedicated refund email instead of reusing the
  // "Thanks for your order" confirmation template. The buyer was
  // getting the wrong email pre-fix; the verify chat caught this.
  after(async () => {
    try {
      const order = await prisma.order.findUnique({
        where: { id },
        include: { items: true },
      });
      if (order) {
        await sendOrderRefunded(order, amountCents, reason);
      }
    } catch (err) {
      captureError(err, {
        subsystem: "email",
        op: "refund-notification",
        orderId: id,
      });
    }
  });

  return NextResponse.json({
    ok: true,
    refundId: result.refundId,
    stripeRefundId: result.stripeRefundId,
  });
}

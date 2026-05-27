import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendOrderDelivered } from "@/lib/email";
import { captureError } from "@/lib/observability";
import { markOrderDelivered } from "@/lib/shipping";

export const runtime = "nodejs";

/**
 * Buyer confirms receipt of a Shipped order. Skips the wait-for-admin path,
 * marks the order Delivered, flips status to FULFILLED so the review flow
 * opens, and fires the "delivered" notification. Only the order's buyer
 * (or an admin acting on their behalf) can call this.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  const isBuyer = !!order.buyerId && order.buyerId === user.id;
  const isAdmin = user.role === "ADMIN";
  if (!isBuyer && !isAdmin) {
    return NextResponse.json(
      { error: "Only the buyer can confirm receipt." },
      { status: 403 }
    );
  }
  if (order.status !== "PAID" || order.shipmentStage !== "Shipped") {
    return NextResponse.json(
      { error: "Order is not currently in Shipped state." },
      { status: 400 }
    );
  }
  // PLH-3g P5: per-supplier delivery. Flip every slot to Delivered.
  // markOrderDelivered handles aggregate Order.shipmentStage +
  // deliveredAt + status="FULFILLED" when ALL slots are Delivered.
  const r = await markOrderDelivered(id);
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  if (r.orderFullyDeliveredNow) {
    const updated = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (updated) {
      after(async () => {
        try {
          await sendOrderDelivered(updated);
        } catch (err) {
          captureError(err, { subsystem: "email", op: "delivered-notify", orderId: id });
        }
      });
    }
  }
  return NextResponse.json({ ok: true });
}

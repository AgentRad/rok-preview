import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isPayPalConfigured, capturePayPalOrder } from "@/lib/paypal";
import { markOrderPaid } from "@/lib/order-utils";

export async function POST(req: Request) {
  if (!isPayPalConfigured()) {
    return NextResponse.json(
      { error: "PayPal is not configured." },
      { status: 400 }
    );
  }
  const { orderId } = await req.json().catch(() => ({}));
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || !order.paypalOrderId) {
    return NextResponse.json(
      { error: "Order not found or PayPal checkout not started." },
      { status: 404 }
    );
  }
  const captured = await capturePayPalOrder(order.paypalOrderId);
  if (!captured) {
    return NextResponse.json(
      { error: "Payment could not be captured." },
      { status: 402 }
    );
  }
  await markOrderPaid(order.id, "paypal", order.paypalOrderId);
  return NextResponse.json({ ok: true });
}

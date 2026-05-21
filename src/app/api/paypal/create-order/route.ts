import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isPayPalConfigured, createPayPalOrder } from "@/lib/paypal";

export async function POST(req: Request) {
  if (!isPayPalConfigured()) {
    return NextResponse.json(
      { error: "PayPal is not configured." },
      { status: 400 }
    );
  }
  const { orderId } = await req.json().catch(() => ({}));
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  try {
    const paypalOrderId = await createPayPalOrder(
      order.totalCents / 100,
      order.reference
    );
    await prisma.order.update({
      where: { id: order.id },
      data: { paypalOrderId },
    });
    return NextResponse.json({ paypalOrderId });
  } catch {
    return NextResponse.json(
      { error: "Could not start PayPal checkout." },
      { status: 502 }
    );
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendOrderDelivered, sendOrderShipped } from "@/lib/email";

const STAGES = ["Processing", "Shipped", "Delivered"] as const;
type Stage = (typeof STAGES)[number];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    stage?: string;
    carrier?: string;
    trackingCode?: string;
  } | null;
  const stage = body?.stage as Stage | undefined;
  if (!stage || !STAGES.includes(stage)) {
    return NextResponse.json({ error: "Invalid stage." }, { status: 400 });
  }

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (order.status !== "PAID" && order.status !== "FULFILLED") {
    return NextResponse.json(
      { error: "Only paid orders can be moved through fulfillment." },
      { status: 400 }
    );
  }

  if (stage === "Shipped") {
    const carrier = body?.carrier?.trim();
    const trackingCode = body?.trackingCode?.trim();
    if (!carrier || !trackingCode) {
      return NextResponse.json(
        { error: "Carrier and tracking code are required to mark shipped." },
        { status: 400 }
      );
    }
    const updated = await prisma.order.update({
      where: { id },
      data: { shipmentStage: "Shipped", carrier, trackingCode },
      include: { items: true },
    });
    sendOrderShipped(updated).catch((err) =>
      console.error("[email] order-shipped failed:", err)
    );
  } else if (stage === "Delivered") {
    const updated = await prisma.order.update({
      where: { id },
      data: { shipmentStage: "Delivered", status: "FULFILLED" },
      include: { items: true },
    });
    sendOrderDelivered(updated).catch((err) =>
      console.error("[email] order-delivered failed:", err)
    );
  } else {
    await prisma.order.update({
      where: { id },
      data: { shipmentStage: "Processing" },
    });
  }

  return NextResponse.json({ ok: true });
}

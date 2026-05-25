import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendOrderDelivered } from "@/lib/email";
import { markOrderShipped } from "@/lib/shipping";

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
    const result = await markOrderShipped(
      id,
      body?.carrier ?? "",
      body?.trackingCode ?? ""
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
  } else if (stage === "Delivered") {
    // Refuse to skip Shipped on the way to Delivered. The buyer's order
    // page renders the tracking card and the shipped-email is what tells
    // the buyer to expect the delivery in the first place. If admin tries
    // to flip a PAID order straight to Delivered, force them to mark
    // Shipped first (which collects carrier + tracking via the shared
    // markOrderShipped helper).
    if (!order.carrier || !order.trackingCode) {
      return NextResponse.json(
        {
          error:
            "Mark this order Shipped first (with a carrier and tracking number) before flipping to Delivered.",
        },
        { status: 400 }
      );
    }
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

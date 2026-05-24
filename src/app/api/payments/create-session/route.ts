import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/payments";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const provider = getProvider();
  if (!provider) {
    return NextResponse.json(
      { error: "Payments are not configured on this environment." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId || "").trim();
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (order.status !== "PENDING") {
    return NextResponse.json(
      { error: "This order is not awaiting payment." },
      { status: 400 }
    );
  }

  try {
    const session = await provider.createCheckoutSession({
      orderId: order.id,
      reference: order.reference,
      amountCents: order.totalCents,
      buyerEmail: order.buyerEmail,
      description: order.items
        .map((i) => `${i.qty} x ${i.nameSnapshot}`)
        .join(", ")
        .slice(0, 480),
    });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("[payments] create-session failed:", err);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 502 }
    );
  }
}

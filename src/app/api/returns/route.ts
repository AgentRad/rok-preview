import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateReference } from "@/lib/order-utils";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId || "").trim();
  const reason = String(body.reason || "").trim();
  const details = String(body.details || "").trim().slice(0, 4000);

  if (!orderId || !reason) {
    return NextResponse.json(
      { error: "Order and reason are required." },
      { status: 400 }
    );
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // The buyer (or an admin) can open a return. Guest orders match by email
  // when the request is sent without a session.
  const isOwner = !!order.buyerId && user?.id === order.buyerId;
  const isAdmin = user?.role === "ADMIN";
  const guestMatch =
    !user && !!body.email &&
    String(body.email).toLowerCase().trim() === order.buyerEmail;
  if (!isOwner && !isAdmin && !guestMatch) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  if (order.status !== "FULFILLED" && order.shipmentStage !== "Delivered") {
    return NextResponse.json(
      {
        error:
          "Return requests can only be opened after the order is delivered.",
      },
      { status: 400 }
    );
  }

  const created = await prisma.returnRequest.create({
    data: {
      reference: generateReference("RMA"),
      orderId,
      buyerId: order.buyerId,
      reason,
      details,
    },
  });

  return NextResponse.json({ ok: true, returnId: created.id, reference: created.reference });
}

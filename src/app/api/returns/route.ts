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

  // P9.5 HIGH 16: signed-in users must verify email before opening a
  // return. Guest path (guestMatch) is unaffected because there's no
  // account to verify.
  if (user && !user.emailVerified) {
    return NextResponse.json(
      {
        error:
          "Verify your email before opening a return. Request a new verification link from /account.",
        code: "EMAIL_NOT_VERIFIED",
      },
      { status: 403 }
    );
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

  // Polish 12 H7: refuse a second OPEN return for the same order. The
  // pre-fix path let a buyer file unlimited duplicates, which junked
  // up admin triage. Existing closed states (APPROVED/REJECTED/
  // RESOLVED) don't block reopening a new request.
  const existingOpen = await prisma.returnRequest.findFirst({
    where: { orderId, status: "OPEN" },
  });
  if (existingOpen) {
    return NextResponse.json(
      {
        error: "You already have an open return request on this order.",
        returnId: existingOpen.id,
        reference: existingOpen.reference,
      },
      { status: 409 }
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

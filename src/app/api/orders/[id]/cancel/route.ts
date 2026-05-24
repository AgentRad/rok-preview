import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const user = await getCurrentUser();
  const isOwner = !!order.buyerId && user?.id === order.buyerId;
  const isAdmin = user?.role === "ADMIN";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  // Only cancel before dispatch. After Shipped, the buyer must open a
  // return request once it arrives.
  if (order.status === "CANCELLED") {
    return NextResponse.json({ ok: true });
  }
  if (order.status === "FULFILLED" || order.shipmentStage === "Shipped" || order.shipmentStage === "Delivered") {
    return NextResponse.json(
      {
        error:
          "This order has already shipped. Open a return request from the order page after delivery.",
      },
      { status: 400 }
    );
  }

  await prisma.$transaction(async (tx) => {
    // Restock items only if we already decremented (PAID state).
    if (order.status === "PAID") {
      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.qty } },
        });
      }
    }
    await tx.order.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    await tx.invoice.updateMany({
      where: { orderId: id },
      data: { status: "VOID" },
    });
  });

  return NextResponse.json({ ok: true });
}

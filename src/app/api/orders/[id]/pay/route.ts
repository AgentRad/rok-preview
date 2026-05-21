import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { markOrderPaid } from "@/lib/order-utils";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  await markOrderPaid(id, "demo");
  return NextResponse.json({ ok: true });
}

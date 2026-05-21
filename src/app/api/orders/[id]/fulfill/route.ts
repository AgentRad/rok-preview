import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { include: { product: true } } },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (order.status !== "PAID") {
    return NextResponse.json(
      { error: "Only paid orders can be marked fulfilled." },
      { status: 400 }
    );
  }
  if (user.role === "SUPPLIER") {
    const supplier = await prisma.supplier.findUnique({
      where: { userId: user.id },
    });
    const involved =
      supplier &&
      order.items.some((i) => i.product.supplierId === supplier.id);
    if (!involved) {
      return NextResponse.json({ error: "Not your order." }, { status: 403 });
    }
  }
  await prisma.order.update({
    where: { id },
    data: { status: "FULFILLED" },
  });
  return NextResponse.json({ ok: true });
}

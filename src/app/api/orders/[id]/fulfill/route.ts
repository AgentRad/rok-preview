import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canFulfillOrders,
  userHasAccessToSupplier,
} from "@/lib/supplier-access";

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
    const supplierIds = Array.from(
      new Set(order.items.map((i) => i.product.supplierId))
    );
    const checks = await Promise.all(
      supplierIds.map((sid) => userHasAccessToSupplier(user.id, sid))
    );
    const allowed = checks.some((c) => c.ok && canFulfillOrders(c.role));
    if (!allowed) {
      return NextResponse.json(
        { error: "Your role on this order doesn't allow fulfillment." },
        { status: 403 }
      );
    }
  }
  await prisma.order.update({
    where: { id },
    data: { status: "FULFILLED" },
  });
  return NextResponse.json({ ok: true });
}

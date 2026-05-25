import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateReference } from "@/lib/order-utils";
import { effectiveBps, feeFor } from "@/lib/money";
import { sendOrderConfirmation } from "@/lib/email";
import { isStripeTaxConfigured } from "@/lib/stripe-tax";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const items: { sku: string; qty: number }[] = Array.isArray(body.items)
    ? body.items
    : [];
  const buyerName = String(body.buyerName || "").trim();
  const buyerEmail = String(body.buyerEmail || "").toLowerCase().trim();
  const shipTo = String(body.shipTo || "").trim();

  if (!buyerName || !buyerEmail || !shipTo) {
    return NextResponse.json(
      { error: "Name, email and delivery address are required." },
      { status: 400 }
    );
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
  }

  const products = await prisma.product.findMany({
    where: { sku: { in: items.map((i) => String(i.sku)) }, active: true },
    include: { supplier: true },
  });
  const bySku = new Map(products.map((p) => [p.sku, p]));

  const orderItems = [];
  let subtotal = 0;
  for (const it of items) {
    const p = bySku.get(String(it.sku));
    const qty = Math.max(1, Math.floor(Number(it.qty) || 0));
    if (!p) continue;
    subtotal += p.priceCents * qty;
    orderItems.push({
      productId: p.id,
      nameSnapshot: p.name,
      skuSnapshot: p.sku,
      supplierName: p.supplier.name,
      unitPriceCents: p.priceCents,
      qty,
    });
  }
  if (orderItems.length === 0) {
    return NextResponse.json(
      { error: "None of the cart items are available." },
      { status: 400 }
    );
  }

  const freight = 0;
  const fee = feeFor(subtotal);
  const tax = 0;
  const total = subtotal + freight + fee + tax;
  const user = await getCurrentUser();

  const order = await prisma.order.create({
    data: {
      reference: generateReference(),
      status: "PENDING",
      buyerId: user?.id ?? null,
      buyerName,
      buyerEmail,
      shipTo,
      subtotalCents: subtotal,
      freightCents: freight,
      feeCents: fee,
      taxCents: tax,
      totalCents: total,
      feeRateBps: effectiveBps(subtotal),
      items: { create: orderItems },
    },
    include: { items: true },
  });

  sendOrderConfirmation(order).catch((err) =>
    console.error("[email] order confirmation failed:", err)
  );

  return NextResponse.json({
    ok: true,
    orderId: order.id,
    reference: order.reference,
    subtotalCents: subtotal,
    freightCents: freight,
    feeCents: fee,
    taxCents: tax,
    totalCents: total,
  });
}

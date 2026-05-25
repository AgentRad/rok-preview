import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateReference } from "@/lib/order-utils";
import { computeOrderTotals } from "@/lib/order-totals";
import { sendOrderConfirmation } from "@/lib/email";

export async function POST(req: Request) {
  // Role gate: OEMs and Suppliers cannot place orders. Core platform rule:
  // OEMs participate free with storefront + demand visibility, and every
  // sale routes to their authorized distributors. Suppliers fulfill, they
  // don't buy through their own dashboard. Buyers and anonymous users are
  // the only roles that can POST here.
  const sessionUser = await getCurrentUser();
  if (sessionUser?.role === "MANUFACTURER") {
    return NextResponse.json(
      {
        error:
          "Manufacturers don't purchase through PartsPort. Orders route to your authorized distributors, with no channel conflict. Sign in as a buyer account if you need to test the buy flow.",
      },
      { status: 403 }
    );
  }
  if (sessionUser?.role === "SUPPLIER") {
    return NextResponse.json(
      {
        error:
          "Suppliers fulfill orders, they don't place them. Sign in as a buyer account if you need to test the buy flow.",
      },
      { status: 403 }
    );
  }

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
  const lines = [];
  for (const it of items) {
    const p = bySku.get(String(it.sku));
    const qty = Math.max(1, Math.floor(Number(it.qty) || 0));
    if (!p) continue;
    orderItems.push({
      productId: p.id,
      nameSnapshot: p.name,
      skuSnapshot: p.sku,
      supplierName: p.supplier.name,
      unitPriceCents: p.priceCents,
      qty,
    });
    lines.push({
      unitPriceCents: p.priceCents,
      qty,
      quoteOnly: p.quoteOnly,
    });
  }
  if (orderItems.length === 0) {
    return NextResponse.json(
      { error: "None of the cart items are available." },
      { status: 400 }
    );
  }

  // Single source of truth for the order math. See src/lib/order-totals.ts.
  // Tax stays 0 here; Stripe Tax snapshots it back in markOrderPaid.
  const totals = computeOrderTotals(lines);
  // Reuse the session lookup we already did up top for the role gate; no
  // need for a second auth round-trip.
  const user = sessionUser;

  const order = await prisma.order.create({
    data: {
      reference: generateReference(),
      status: "PENDING",
      buyerId: user?.id ?? null,
      buyerName,
      buyerEmail,
      // Snapshot the buyer's company branding onto the Order so future
      // profile edits don't retroactively rewrite this invoice. Guest
      // checkout has no user, so these stay null and the invoice falls
      // back to no-logo rendering.
      buyerCompanyName: user?.companyName ?? null,
      buyerCompanyLogoUrl: user?.companyLogoUrl ?? null,
      shipTo,
      subtotalCents: totals.subtotalCents,
      freightCents: totals.freightCents,
      feeCents: totals.feeCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      feeRateBps: totals.feeRateBps,
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
    subtotalCents: totals.subtotalCents,
    freightCents: totals.freightCents,
    feeCents: totals.feeCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
  });
}

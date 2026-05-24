import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Returns the items from a past order in a shape the client can drop into
 * the cart. Re-resolves each product to make sure it is still active, and
 * reports anything that has been delisted so the buyer knows what was
 * dropped (instead of silently skipping).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!order || order.buyerId !== user.id) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const skus = order.items.map((i) => i.skuSnapshot);
  const products = await prisma.product.findMany({
    where: { sku: { in: skus }, active: true },
    select: { sku: true, name: true, stock: true, quoteOnly: true },
  });
  const liveBySku = new Map(products.map((p) => [p.sku, p]));

  const items: { sku: string; qty: number }[] = [];
  const skipped: { sku: string; name: string; reason: string }[] = [];

  for (const it of order.items) {
    const live = liveBySku.get(it.skuSnapshot);
    if (!live) {
      skipped.push({
        sku: it.skuSnapshot,
        name: it.nameSnapshot,
        reason: "no longer listed",
      });
      continue;
    }
    if (live.quoteOnly) {
      skipped.push({
        sku: it.skuSnapshot,
        name: live.name,
        reason: "now quote-only; request a new quote",
      });
      continue;
    }
    items.push({ sku: it.skuSnapshot, qty: it.qty });
  }

  return NextResponse.json({ ok: true, items, skipped });
}

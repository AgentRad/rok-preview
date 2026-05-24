import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in to review." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const productId = String(body.productId || "").trim();
  const rating = Math.max(1, Math.min(5, Math.floor(Number(body.rating) || 0)));
  const text = String(body.body || "").trim().slice(0, 2000);

  if (!productId || !rating) {
    return NextResponse.json(
      { error: "A product and a rating between 1 and 5 are required." },
      { status: 400 }
    );
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }

  // Eligibility: buyer must have at least one FULFILLED order containing this product.
  const eligible = await prisma.order.findFirst({
    where: {
      buyerId: user.id,
      status: "FULFILLED",
      items: { some: { productId } },
    },
    select: { id: true },
  });
  if (!eligible) {
    return NextResponse.json(
      { error: "You can only review a part after a delivered order for it." },
      { status: 403 }
    );
  }

  await prisma.review.upsert({
    where: { buyerId_productId: { buyerId: user.id, productId } },
    create: {
      buyerId: user.id,
      productId,
      supplierId: product.supplierId,
      rating,
      body: text,
    },
    update: { rating, body: text },
  });

  return NextResponse.json({ ok: true });
}

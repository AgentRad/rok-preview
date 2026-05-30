import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in to review." }, { status: 401 });
  }
  // P9.5 HIGH 16: email-verification gate. Mirrors orders/quotes/returns.
  // Reviews carry social weight; gated to verified buyers only.
  if (!user.emailVerified) {
    return NextResponse.json(
      {
        error:
          "Verify your email before posting reviews. Request a new verification link from /account.",
        code: "EMAIL_NOT_VERIFIED",
      },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const productId = String(body.productId || "").trim();
  const orderId = String(body.orderId || "").trim();
  const rating = Math.max(1, Math.min(5, Math.floor(Number(body.rating) || 0)));
  const title = String(body.title || "").trim().slice(0, 140);
  const text = String(body.body || "").trim().slice(0, 4000);

  if (!productId || !orderId || !rating) {
    return NextResponse.json(
      { error: "Product, order, and a rating from 1 to 5 are required." },
      { status: 400 }
    );
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }

  // The order must belong to this buyer, be FULFILLED, and contain the
  // product. This is the verified-delivered-order gate.
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      buyerId: user.id,
      status: "FULFILLED",
      items: { some: { productId } },
    },
    select: { id: true },
  });
  if (!order) {
    return NextResponse.json(
      { error: "You can only review a part on an order of yours that has been delivered." },
      { status: 403 }
    );
  }

  await prisma.review.upsert({
    where: {
      buyerId_productId_orderId: {
        buyerId: user.id,
        productId,
        orderId,
      },
    },
    create: {
      buyerId: user.id,
      productId,
      supplierId: product.supplierId,
      orderId,
      rating,
      title,
      body: text,
    },
    update: { rating, title, body: text },
  });

  return NextResponse.json({ ok: true });
}

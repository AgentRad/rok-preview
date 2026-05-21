import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateReference } from "@/lib/order-utils";
import { feeFor, FEE_RATE_BPS } from "@/lib/money";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const quote = await prisma.quoteRequest.findUnique({
    where: { id },
    include: { product: { include: { supplier: true } } },
  });
  if (!quote) {
    return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  }
  if (quote.status === "ACCEPTED" && quote.orderId) {
    return NextResponse.json({ ok: true, orderId: quote.orderId });
  }
  if (quote.status !== "QUOTED" || quote.quotedUnitCents == null) {
    return NextResponse.json(
      { error: "This quote is not ready to accept yet." },
      { status: 400 }
    );
  }

  const subtotal = quote.quotedUnitCents * quote.qty;
  const fee = feeFor(subtotal);

  const order = await prisma.order.create({
    data: {
      reference: generateReference(),
      status: "PENDING",
      buyerId: quote.buyerId,
      buyerName: quote.buyerName,
      buyerEmail: quote.buyerEmail,
      shipTo: quote.company || "To be confirmed",
      subtotalCents: subtotal,
      feeCents: fee,
      totalCents: subtotal + fee,
      feeRateBps: FEE_RATE_BPS,
      items: {
        create: [
          {
            productId: quote.productId,
            nameSnapshot: quote.product.name,
            skuSnapshot: quote.product.sku,
            supplierName: quote.product.supplier.name,
            unitPriceCents: quote.quotedUnitCents,
            qty: quote.qty,
          },
        ],
      },
    },
  });

  await prisma.quoteRequest.update({
    where: { id },
    data: { status: "ACCEPTED", orderId: order.id },
  });

  return NextResponse.json({ ok: true, orderId: order.id });
}

import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateReference } from "@/lib/order-utils";
import { sendRfqReceived } from "@/lib/email";
import { captureError } from "@/lib/observability";

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const sku = String(b.sku || "");
  const name = String(b.name || "").trim();
  const email = String(b.email || "").toLowerCase().trim();
  if (!name || !email) {
    return NextResponse.json(
      { error: "Name and a work email are required." },
      { status: 400 }
    );
  }
  const product = await prisma.product.findUnique({
    where: { sku },
    include: { supplier: true },
  });
  if (!product || !product.active) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }
  const qty = Math.max(1, Math.floor(Number(b.qty) || 1));
  const user = await getCurrentUser();

  const quote = await prisma.quoteRequest.create({
    data: {
      reference: generateReference("RFQ"),
      productId: product.id,
      qty,
      buyerId: user?.id ?? null,
      buyerName: name,
      buyerEmail: email,
      company: String(b.company || "").trim(),
      message: String(b.message || "").trim(),
      status: "OPEN",
    },
  });

  after(async () => {
    try {
      await sendRfqReceived({
        id: quote.id,
        reference: quote.reference,
        buyerName: quote.buyerName,
        buyerEmail: quote.buyerEmail,
        qty: quote.qty,
        message: quote.message,
        productName: product.name,
        productSku: product.sku,
        supplierName: product.supplier.name,
        supplierEmail: product.supplier.contactEmail,
      });
    } catch (err) {
      captureError(err, { subsystem: "email", op: "rfq-received", quoteId: quote.id });
    }
  });

  return NextResponse.json({
    ok: true,
    quoteId: quote.id,
    reference: quote.reference,
  });
}

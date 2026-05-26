import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateReference } from "@/lib/order-utils";
import { sendRfqReceived } from "@/lib/email";
import { captureError } from "@/lib/observability";
import { writeAuditLog } from "@/lib/audit";

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

  // P9.5 HIGH 15: signed-in users must verify email before requesting a
  // quote. Mirrors the orders POST gate. Anonymous buyers (no session)
  // still pass through; the brief expects guest RFQs to work.
  if (user && !user.emailVerified) {
    return NextResponse.json(
      {
        error:
          "Verify your email before requesting quotes. Check your inbox for the welcome email, or request a new verification link from /account.",
        code: "EMAIL_NOT_VERIFIED",
      },
      { status: 403 }
    );
  }

  // Polish 12 M5: dedupe OPEN quotes for the same (product, email).
  // Prevents a buyer who refreshes the RFQ form from kicking off a
  // second supplier email + duplicating triage work.
  const existingOpen = await prisma.quoteRequest.findFirst({
    where: { productId: product.id, buyerEmail: email, status: "OPEN" },
    orderBy: { createdAt: "desc" },
  });
  if (existingOpen) {
    return NextResponse.json({
      ok: true,
      quoteId: existingOpen.id,
      reference: existingOpen.reference,
      deduped: true,
    });
  }

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

  // Polish 12 M3: audit RFQ submission.
  await writeAuditLog({
    actor: { id: user?.id || "guest", email: user?.email || email },
    action: "QUOTE_SUBMITTED",
    targetType: "QuoteRequest",
    targetId: quote.id,
    summary: `Quote ${quote.reference} submitted for ${product.sku} (qty ${qty}).`,
    metadata: {
      quoteReference: quote.reference,
      productSku: product.sku,
      qty,
      supplierId: product.supplierId,
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

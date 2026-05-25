import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { dollarsToCents } from "@/lib/money";
import { sendQuoteReady } from "@/lib/email";
import {
  canRespondToQuotes,
  userHasAccessToSupplier,
} from "@/lib/supplier-access";
import { captureError } from "@/lib/observability";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const quote = await prisma.quoteRequest.findUnique({
    where: { id },
    include: { product: true },
  });
  if (!quote) {
    return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  }
  if (quote.status === "ACCEPTED") {
    return NextResponse.json(
      { error: "This quote has already been accepted." },
      { status: 400 }
    );
  }

  if (b.action === "decline") {
    await prisma.quoteRequest.update({
      where: { id },
      data: { status: "DECLINED" },
    });
    return NextResponse.json({ ok: true });
  }

  if (b.action === "quote") {
    const user = await getCurrentUser();
    if (user && !user.emailVerified && user.role !== "ADMIN") {
      return NextResponse.json(
        {
          error:
            "Verify your email before responding to RFQs. Request a new verification link from /account.",
          code: "EMAIL_NOT_VERIFIED",
        },
        { status: 403 }
      );
    }
    if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }
    if (user.role === "SUPPLIER") {
      const access = await userHasAccessToSupplier(
        user.id,
        quote.product.supplierId
      );
      if (!access.ok) {
        return NextResponse.json(
          { error: "Not your product." },
          { status: 403 }
        );
      }
      if (!canRespondToQuotes(access.role)) {
        return NextResponse.json(
          {
            error: "Your role doesn't allow responding to RFQs.",
          },
          { status: 403 }
        );
      }
    }
    const price = Number(b.unitPrice);
    if (!(price > 0)) {
      return NextResponse.json(
        { error: "A unit price is required." },
        { status: 400 }
      );
    }
    const updated = await prisma.quoteRequest.update({
      where: { id },
      data: {
        quotedUnitCents: dollarsToCents(price),
        quoteNote: String(b.note || "").trim(),
        status: "QUOTED",
        quotedAt: new Date(),
      },
      include: { product: { include: { supplier: true } } },
    });
    after(async () => {
      try {
        await sendQuoteReady({
          id: updated.id,
          reference: updated.reference,
          buyerName: updated.buyerName,
          buyerEmail: updated.buyerEmail,
          qty: updated.qty,
          message: updated.message,
          productName: updated.product.name,
          productSku: updated.product.sku,
          supplierName: updated.product.supplier.name,
          quotedUnitCents: updated.quotedUnitCents,
          quoteNote: updated.quoteNote,
        });
      } catch (err) {
        captureError(err, { subsystem: "email", op: "quote-ready", quoteId: updated.id });
      }
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

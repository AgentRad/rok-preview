import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { dollarsToCents } from "@/lib/money";

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
    if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }
    if (user.role === "SUPPLIER") {
      const supplier = await prisma.supplier.findUnique({
        where: { userId: user.id },
      });
      if (!supplier || supplier.id !== quote.product.supplierId) {
        return NextResponse.json(
          { error: "Not your product." },
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
    await prisma.quoteRequest.update({
      where: { id },
      data: {
        quotedUnitCents: dollarsToCents(price),
        quoteNote: String(b.note || "").trim(),
        status: "QUOTED",
        quotedAt: new Date(),
      },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

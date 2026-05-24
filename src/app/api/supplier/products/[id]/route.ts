import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { dollarsToCents } from "@/lib/money";
import { canEditCatalog, userHasAccessToSupplier } from "@/lib/supplier-access";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }
  if (user.role === "SUPPLIER") {
    const access = await userHasAccessToSupplier(user.id, product.supplierId);
    if (!access.ok) {
      return NextResponse.json({ error: "Not your product." }, { status: 403 });
    }
    if (!canEditCatalog(access.role)) {
      return NextResponse.json(
        { error: "Your role doesn't allow editing the catalog." },
        { status: 403 }
      );
    }
  }

  const b = await req.json().catch(() => ({}));
  const data: {
    priceCents?: number;
    stock?: number;
    active?: boolean;
    imageUrl?: string | null;
  } = {};
  if (b.price !== undefined && Number(b.price) > 0) {
    data.priceCents = dollarsToCents(Number(b.price));
  }
  if (b.stock !== undefined) {
    data.stock = Math.max(0, Math.floor(Number(b.stock) || 0));
  }
  if (b.active !== undefined) {
    data.active = Boolean(b.active);
  }
  if (b.imageUrl !== undefined) {
    data.imageUrl = String(b.imageUrl || "").trim() || null;
  }
  await prisma.product.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

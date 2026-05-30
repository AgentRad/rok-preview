import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  const { skus } = await req.json().catch(() => ({}));
  if (!Array.isArray(skus) || skus.length === 0) {
    return NextResponse.json({ products: [] });
  }
  const products = await prisma.product.findMany({
    where: { sku: { in: skus.map(String) }, active: true },
    include: { supplier: true },
  });
  return NextResponse.json({
    products: products.map((p) => ({
      sku: p.sku,
      name: p.name,
      icon: p.icon,
      imageUrl: p.imageUrl,
      manufacturer: p.manufacturer,
      category: p.category,
      unit: p.unit,
      priceCents: p.priceCents,
      etaDays: p.etaDays,
      stock: p.stock,
      quoteOnly: p.quoteOnly,
      supplierId: p.supplierId,
      supplierName: p.supplier.name,
    })),
  });
}

import { NextResponse } from "next/server";
import { quickSearch } from "@/lib/search";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") || "";
  const products = await quickSearch(q);
  return NextResponse.json({
    products: products.slice(0, 6).map((p) => ({
      sku: p.sku,
      name: p.name,
      manufacturer: p.manufacturer,
      category: p.category,
      icon: p.icon,
      imageUrl: p.imageUrl,
      priceCents: p.priceCents,
      unit: p.unit,
      etaDays: p.etaDays,
      stock: p.stock,
      quoteOnly: p.quoteOnly,
      supplierName: p.supplier.name,
    })),
  });
}

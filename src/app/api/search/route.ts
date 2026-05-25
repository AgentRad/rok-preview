import { NextResponse } from "next/server";
import { quickSearch } from "@/lib/search";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function GET(req: Request) {
  const limit = rateLimit("search", clientIp(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Search rate limit exceeded. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      }
    );
  }
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

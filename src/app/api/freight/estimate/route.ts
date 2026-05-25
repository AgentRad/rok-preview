import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { getFreightRates, isShippoConfigured } from "@/lib/freight-server";
import type { FreightRate } from "@/lib/freight";

export const runtime = "nodejs";

/**
 * Product-page freight widget endpoint. Buyer enters their ZIP, we look
 * up the product's supplier default warehouse, ask Shippo for the top
 * rates, and return them to render in the widget.
 *
 * Rate-limited at 1 request per 10 seconds per IP via a dedicated bucket
 * so a typo-spamming buyer can't burn Shippo quota.
 */

// Lazily registered bucket: lib/rate-limit.ts BUCKETS map needs the entry,
// otherwise the generic catch-all kicks in. Inline the limit here so this
// route is self-contained.
const BUCKET_NAME = "freight-estimate";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const limit = await rateLimit(BUCKET_NAME, ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Please wait a moment before requesting another estimate." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      }
    );
  }
  const body = await req.json().catch(() => ({}));
  const sku = String(body.sku || "").trim();
  const destZip = String(body.destZip || "").trim();
  const qty = Math.max(1, Math.floor(Number(body.qty) || 1));

  if (!sku || !/^\d{5}/.test(destZip)) {
    return NextResponse.json(
      { error: "Provide a product SKU and a 5-digit destination ZIP." },
      { status: 400 }
    );
  }
  if (!isShippoConfigured()) {
    return NextResponse.json(
      {
        ok: true,
        configured: false,
        rates: [] as FreightRate[],
        message:
          "Live freight quotes aren't configured on this deployment. Standard ground rates apply at checkout.",
      },
      { status: 200 }
    );
  }
  const product = await prisma.product.findUnique({
    where: { sku },
    include: {
      supplier: {
        include: {
          warehouses: { orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] },
        },
      },
    },
  });
  if (!product) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }
  if (!product.active) {
    return NextResponse.json({ error: "Product is not available." }, { status: 400 });
  }
  if (
    product.weightLbs == null ||
    product.lengthIn == null ||
    product.widthIn == null ||
    product.heightIn == null
  ) {
    return NextResponse.json(
      {
        ok: true,
        configured: true,
        rates: [] as FreightRate[],
        message:
          "This product doesn't have weight + dimensions on file yet. Use the catalog freight estimate or contact the supplier.",
      },
      { status: 200 }
    );
  }
  const warehouse =
    product.supplier.warehouses.find((w) => w.isDefault) ||
    product.supplier.warehouses[0];
  if (!warehouse) {
    return NextResponse.json(
      {
        ok: true,
        configured: true,
        rates: [] as FreightRate[],
        message:
          "Supplier hasn't registered an origin warehouse. Freight will be quoted at checkout.",
      },
      { status: 200 }
    );
  }
  const rates = await getFreightRates({
    originZip: warehouse.zip,
    destZip,
    items: [
      {
        weightLbs: product.weightLbs,
        lengthIn: product.lengthIn,
        widthIn: product.widthIn,
        heightIn: product.heightIn,
        qty,
      },
    ],
  });
  return NextResponse.json({
    ok: true,
    configured: true,
    rates,
    originCity: warehouse.city,
    originState: warehouse.state,
    originZip: warehouse.zip,
  });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import {
  authorizeProductEdit,
  MAX_IMAGES_PER_PRODUCT,
} from "@/lib/product-image-auth";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const images = await prisma.productImage.findMany({
    where: { productId: id },
    orderBy: { ordinal: "asc" },
  });
  return NextResponse.json({ images, max: MAX_IMAGES_PER_PRODUCT });
}

/**
 * POST: add an image by external URL. Kept for the "Add image by URL"
 * fallback in the UI when Vercel Blob is not configured. Magic-byte
 * validation only applies to direct uploads; external URLs are accepted
 * as-is but capped to 12 per product and rate-limited per supplier.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authorizeProductEdit(id);
  if (auth.error) return auth.error;

  const rl = await rateLimit("generic", `supplier:${auth.user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const url = String(body.url || "").trim();
  if (!url) {
    return NextResponse.json({ error: "Image URL is required." }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json(
      { error: "Image URL must start with https:// or http://." },
      { status: 400 }
    );
  }

  const count = await prisma.productImage.count({ where: { productId: id } });
  if (count >= MAX_IMAGES_PER_PRODUCT) {
    return NextResponse.json(
      { error: `Max ${MAX_IMAGES_PER_PRODUCT} images per product.` },
      { status: 400 }
    );
  }

  const image = await prisma.productImage.create({
    data: { productId: id, url, ordinal: count },
  });

  if (count === 0) {
    await prisma.product.update({
      where: { id },
      data: { imageUrl: url },
    });
  }

  await writeAuditLog({
    actor: auth.user,
    action: "IMAGE_UPLOADED",
    targetType: "ProductImage",
    targetId: image.id,
    summary: `Added image by URL to product ${id}`,
    metadata: { productId: id, source: "url", ordinal: image.ordinal },
  });

  return NextResponse.json({ ok: true, image });
}

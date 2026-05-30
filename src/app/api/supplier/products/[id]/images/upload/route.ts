import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { detectMagic, safeExt } from "@/lib/upload-validation";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import {
  authorizeProductEdit,
  MAX_IMAGES_PER_PRODUCT,
} from "@/lib/product-image-auth";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB per image (PLH-3h spec)

// Map of detected magic-byte MIME to a safe canonical extension. We do
// not trust the original filename; safeExt() further sanitizes if needed
// but the magic-detected MIME is the source of truth.
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "File uploads are not configured. Add a Vercel Blob store to the project (Storage > Create > Blob). Until then, paste image URLs.",
      },
      { status: 503 }
    );
  }

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

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Invalid upload payload." }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files attached." }, { status: 400 });
  }

  const existingCount = await prisma.productImage.count({ where: { productId: id } });
  if (existingCount >= MAX_IMAGES_PER_PRODUCT) {
    return NextResponse.json(
      { error: `Max ${MAX_IMAGES_PER_PRODUCT} images per product.` },
      { status: 400 }
    );
  }
  const remainingSlots = MAX_IMAGES_PER_PRODUCT - existingCount;

  const created: { id: string; url: string; ordinal: number; alt: string }[] = [];
  const errors: string[] = [];

  for (let i = 0; i < files.length; i++) {
    if (created.length >= remainingSlots) {
      errors.push(
        `${files[i].name}: skipped (would exceed ${MAX_IMAGES_PER_PRODUCT}-image cap).`
      );
      continue;
    }
    const file = files[i];
    if (file.size > MAX_BYTES) {
      errors.push(
        `${file.name}: too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`
      );
      continue;
    }
    const magic = await detectMagic(file);
    if (!magic || !(magic in EXT_BY_MIME)) {
      errors.push(
        `${file.name}: unsupported type. Use PNG, JPEG, or WEBP.`
      );
      continue;
    }
    const ext = EXT_BY_MIME[magic] || safeExt(file.name, "jpg");
    try {
      const ordinal = existingCount + created.length;
      // PLH-3c F8 random-suffix pattern: a per-product 8-byte hex folder
      // breaks deterministic URL guessing. Per-file name uses the ordinal
      // so the blob URL is deterministic within the gallery.
      const suffix = crypto.randomBytes(8).toString("hex");
      const blobPath = `products/${id}_${suffix}/img-${ordinal}.${ext}`;
      const blob = await put(blobPath, file, {
        access: "public",
        contentType: magic,
      });
      const image = await prisma.productImage.create({
        data: { productId: id, url: blob.url, ordinal, alt: "" },
      });
      created.push({ id: image.id, url: image.url, ordinal: image.ordinal, alt: image.alt });

      await writeAuditLog({
        actor: auth.user,
        action: "IMAGE_UPLOADED",
        targetType: "ProductImage",
        targetId: image.id,
        summary: `Uploaded image to product ${id}`,
        metadata: { productId: id, source: "upload", ordinal, mime: magic, bytes: file.size },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed.";
      errors.push(`${file.name}: ${msg}`);
    }
  }

  if (created.length > 0) {
    const first = await prisma.productImage.findFirst({
      where: { productId: id },
      orderBy: { ordinal: "asc" },
    });
    if (first) {
      await prisma.product.update({
        where: { id },
        data: { imageUrl: first.url },
      });
    }
  }

  return NextResponse.json({ ok: true, images: created, errors });
}

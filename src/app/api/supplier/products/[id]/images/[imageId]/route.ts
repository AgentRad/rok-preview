import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { authorizeProductEdit } from "@/lib/product-image-auth";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const { id, imageId } = await params;
  const auth = await authorizeProductEdit(id);
  if (auth.error) return auth.error;

  const rl = await rateLimit("generic", `supplier:${auth.user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId: id },
  });
  if (!image) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }

  // Delete then repack ordinals through the negative-band two-pass trick
  // so the unique (productId, ordinal) index never collides.
  const remainingBefore = await prisma.productImage.findMany({
    where: { productId: id, NOT: { id: imageId } },
    orderBy: { ordinal: "asc" },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.productImage.delete({ where: { id: imageId } }),
    ...remainingBefore.map((row, idx) =>
      prisma.productImage.update({
        where: { id: row.id },
        data: { ordinal: -1000 - idx },
      })
    ),
    ...remainingBefore.map((row, ordinal) =>
      prisma.productImage.update({
        where: { id: row.id },
        data: { ordinal },
      })
    ),
  ]);

  const first = await prisma.productImage.findFirst({
    where: { productId: id },
    orderBy: { ordinal: "asc" },
  });
  await prisma.product.update({
    where: { id },
    data: { imageUrl: first?.url ?? null },
  });

  await writeAuditLog({
    actor: auth.user,
    action: "IMAGE_DELETED",
    targetType: "ProductImage",
    targetId: imageId,
    summary: `Deleted image from product ${id}`,
    metadata: { productId: id, url: image.url, ordinal: image.ordinal },
  });

  return NextResponse.json({ ok: true });
}

/**
 * PATCH: update alt text on an image. Trimmed and capped at 200 chars.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const { id, imageId } = await params;
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
  if (typeof body.alt !== "string") {
    return NextResponse.json({ error: "alt must be a string." }, { status: 400 });
  }
  const alt = body.alt.trim().slice(0, 200);

  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId: id },
  });
  if (!image) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }

  const updated = await prisma.productImage.update({
    where: { id: imageId },
    data: { alt },
  });

  await writeAuditLog({
    actor: auth.user,
    action: "IMAGE_ALT_UPDATED",
    targetType: "ProductImage",
    targetId: imageId,
    summary: `Updated alt text on image of product ${id}`,
    metadata: { productId: id, len: alt.length },
  });

  return NextResponse.json({ ok: true, image: updated });
}

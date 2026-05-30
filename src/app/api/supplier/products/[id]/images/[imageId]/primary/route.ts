import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { authorizeProductEdit } from "@/lib/product-image-auth";

export const runtime = "nodejs";

export async function POST(
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

  const target = await prisma.productImage.findFirst({
    where: { id: imageId, productId: id },
  });
  if (!target) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }

  if (target.ordinal === 0) {
    return NextResponse.json({ ok: true, alreadyPrimary: true });
  }

  // Pull all images, move target to position 0, shift others up.
  const all = await prisma.productImage.findMany({
    where: { productId: id },
    orderBy: { ordinal: "asc" },
    select: { id: true },
  });
  const reordered = [
    target.id,
    ...all.filter((r) => r.id !== target.id).map((r) => r.id),
  ];

  // Two-pass shuffle through the negative-ordinal band to avoid the
  // unique (productId, ordinal) collision mid-transaction.
  await prisma.$transaction([
    ...reordered.map((rowId, idx) =>
      prisma.productImage.update({
        where: { id: rowId },
        data: { ordinal: -1000 - idx },
      })
    ),
    ...reordered.map((rowId, ordinal) =>
      prisma.productImage.update({
        where: { id: rowId },
        data: { ordinal },
      })
    ),
  ]);

  await prisma.product.update({
    where: { id },
    data: { imageUrl: target.url },
  });

  await writeAuditLog({
    actor: auth.user,
    action: "IMAGE_SET_PRIMARY",
    targetType: "ProductImage",
    targetId: imageId,
    summary: `Set image as primary for product ${id}`,
    metadata: { productId: id, previousOrdinal: target.ordinal },
  });

  return NextResponse.json({ ok: true });
}

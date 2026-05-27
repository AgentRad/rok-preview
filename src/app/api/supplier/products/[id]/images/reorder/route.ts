import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { authorizeProductEdit } from "@/lib/product-image-auth";

export const runtime = "nodejs";

async function handle(
  req: Request,
  productId: string
): Promise<NextResponse> {
  const auth = await authorizeProductEdit(productId);
  if (auth.error) return auth.error;

  const rl = await rateLimit("generic", `supplier:${auth.user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const order: unknown = body.order;
  if (!Array.isArray(order) || order.some((v) => typeof v !== "string")) {
    return NextResponse.json(
      { error: "order must be an array of image IDs." },
      { status: 400 }
    );
  }
  const orderIds = order as string[];

  const existing = await prisma.productImage.findMany({
    where: { productId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  if (
    orderIds.length !== existing.length ||
    orderIds.some((oid) => !existingIds.has(oid))
  ) {
    return NextResponse.json(
      { error: "Order list does not match this product's images." },
      { status: 400 }
    );
  }

  // (productId, ordinal) is unique. Two-pass shuffle through negative
  // ordinals so the unique constraint cannot collide mid-transaction.
  await prisma.$transaction([
    ...orderIds.map((imageId, idx) =>
      prisma.productImage.update({
        where: { id: imageId },
        data: { ordinal: -1000 - idx },
      })
    ),
    ...orderIds.map((imageId, ordinal) =>
      prisma.productImage.update({
        where: { id: imageId },
        data: { ordinal },
      })
    ),
  ]);

  const first = await prisma.productImage.findFirst({
    where: { productId },
    orderBy: { ordinal: "asc" },
  });
  await prisma.product.update({
    where: { id: productId },
    data: { imageUrl: first?.url ?? null },
  });

  await writeAuditLog({
    actor: auth.user,
    action: "IMAGES_REORDERED",
    targetType: "Product",
    targetId: productId,
    summary: `Reordered images for product ${productId}`,
    metadata: { productId, order: orderIds },
  });

  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handle(req, id);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handle(req, id);
}

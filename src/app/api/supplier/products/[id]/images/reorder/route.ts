import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import type { User } from "@prisma/client";
import { canEditCatalog, effectiveAccessToSupplier } from "@/lib/supplier-access";

export const runtime = "nodejs";

async function authorize(productId: string) {
  const user: User | null = await getCurrentUser();
  if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
    return { error: NextResponse.json({ error: "Not authorized." }, { status: 403 }) };
  }
  if (user.role === "ADMIN") {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return { error: NextResponse.json({ error: "Product not found." }, { status: 404 }) };
    }
    return { product };
  }
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { supplier: true },
  });
  if (!product) {
    return { error: NextResponse.json({ error: "Product not found." }, { status: 404 }) };
  }
  const access = await effectiveAccessToSupplier(user, product.supplierId);
  if (!access.ok || !canEditCatalog(access.role)) {
    return { error: NextResponse.json({ error: "Not your product." }, { status: 403 }) };
  }
  return { product };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authorize(id);
  if (auth.error) return auth.error;

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
    where: { productId: id },
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

  // PLH-3h: (productId, ordinal) is unique, so writing sequential ordinals
  // in one pass would collide mid-transaction. Two-step shuffle: move
  // everyone to negative ordinals first (offset by -1000 to clear the
  // positive band the unique key lives in), then write the final values.
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
    where: { productId: id },
    orderBy: { ordinal: "asc" },
  });
  await prisma.product.update({
    where: { id },
    data: { imageUrl: first?.url ?? null },
  });

  return NextResponse.json({ ok: true });
}

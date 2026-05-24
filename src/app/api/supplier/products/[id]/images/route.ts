import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

async function ownedProduct(userId: string, productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { supplier: true },
  });
  if (!product) return null;
  if (product.supplier.userId !== userId) return null;
  return product;
}

async function requireSupplierProduct(req: Request, productId: string) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
    return { error: NextResponse.json({ error: "Not authorized." }, { status: 403 }) };
  }
  // Admins bypass ownership; suppliers must own the product.
  if (user.role === "ADMIN") {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return { error: NextResponse.json({ error: "Product not found." }, { status: 404 }) };
    }
    return { product };
  }
  const product = await ownedProduct(user.id, productId);
  if (!product) {
    return { error: NextResponse.json({ error: "Not your product." }, { status: 403 }) };
  }
  void req;
  return { product };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const images = await prisma.productImage.findMany({
    where: { productId: id },
    orderBy: { position: "asc" },
  });
  return NextResponse.json({ images });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireSupplierProduct(req, id);
  if (auth.error) return auth.error;

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

  const last = await prisma.productImage.findFirst({
    where: { productId: id },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const next = (last?.position ?? -1) + 1;
  const image = await prisma.productImage.create({
    data: { productId: id, url, position: next },
  });

  // Keep the legacy Product.imageUrl in sync with the first image so the
  // older single-image render path stays consistent until it is retired.
  if (next === 0) {
    await prisma.product.update({
      where: { id },
      data: { imageUrl: url },
    });
  }

  return NextResponse.json({ ok: true, image });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireSupplierProduct(req, id);
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const imageId = String(body.imageId || "").trim();
  if (!imageId) {
    return NextResponse.json({ error: "imageId is required." }, { status: 400 });
  }
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId: id },
  });
  if (!image) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }
  await prisma.productImage.delete({ where: { id: imageId } });

  // Repack positions and refresh Product.imageUrl from the remaining images.
  const remaining = await prisma.productImage.findMany({
    where: { productId: id },
    orderBy: { position: "asc" },
  });
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].position !== i) {
      await prisma.productImage.update({
        where: { id: remaining[i].id },
        data: { position: i },
      });
    }
  }
  await prisma.product.update({
    where: { id },
    data: { imageUrl: remaining[0]?.url ?? null },
  });

  return NextResponse.json({ ok: true });
}

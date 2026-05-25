import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import type { User } from "@prisma/client";
import { canEditCatalog, effectiveAccessToSupplier } from "@/lib/supplier-access";

export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "File uploads are not configured. Add a Vercel Blob store to the project (Storage > Create > Blob) and the BLOB_READ_WRITE_TOKEN will auto-populate. Until then, paste image URLs.",
      },
      { status: 503 }
    );
  }

  const { id } = await params;
  const auth = await authorize(id);
  if (auth.error) return auth.error;

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Invalid upload payload." }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files attached." }, { status: 400 });
  }

  const startPos =
    ((
      await prisma.productImage.findFirst({
        where: { productId: id },
        orderBy: { position: "desc" },
        select: { position: true },
      })
    )?.position ?? -1) + 1;

  const created: { id: string; url: string; position: number }[] = [];
  const errors: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!ALLOWED.has(file.type)) {
      errors.push(`${file.name}: unsupported type (${file.type || "unknown"}). Use JPG, PNG, or WEBP.`);
      continue;
    }
    if (file.size > MAX_BYTES) {
      errors.push(`${file.name}: too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 8 MB.`);
      continue;
    }
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const safeName = `products/${id}/${Date.now()}-${i}.${ext}`;
      const blob = await put(safeName, file, {
        access: "public",
        addRandomSuffix: true,
        contentType: file.type,
      });
      const image = await prisma.productImage.create({
        data: { productId: id, url: blob.url, position: startPos + created.length },
      });
      created.push({ id: image.id, url: image.url, position: image.position });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed.";
      errors.push(`${file.name}: ${msg}`);
    }
  }

  if (created.length > 0) {
    const first = await prisma.productImage.findFirst({
      where: { productId: id },
      orderBy: { position: "asc" },
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

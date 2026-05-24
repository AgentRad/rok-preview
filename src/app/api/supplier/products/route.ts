import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { dollarsToCents } from "@/lib/money";
import { ICON_KEYS } from "@/components/PartIcon";
import { canEditCatalog, getActiveSupplierContext } from "@/lib/supplier-access";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const ctx = await getActiveSupplierContext(user);
  if (!ctx) {
    return NextResponse.json(
      { error: "No supplier profile is linked to this account." },
      { status: 400 }
    );
  }
  if (!canEditCatalog(ctx.role)) {
    return NextResponse.json(
      { error: "Your role doesn't allow editing the catalog." },
      { status: 403 }
    );
  }
  const supplier = ctx.supplier;

  const b = await req.json().catch(() => ({}));
  const sku = String(b.sku || "").trim().toUpperCase();
  const name = String(b.name || "").trim();
  const category = String(b.category || "").trim();
  const manufacturer = String(b.manufacturer || "").trim();
  const price = Number(b.price);
  const etaDays = Math.max(1, Math.floor(Number(b.etaDays) || 0));
  const stock = Math.max(0, Math.floor(Number(b.stock) || 0));

  if (!sku || !name || !category || !manufacturer || !(price > 0)) {
    return NextResponse.json(
      { error: "SKU, name, category, manufacturer and a price are required." },
      { status: 400 }
    );
  }
  const clash = await prisma.product.findUnique({ where: { sku } });
  if (clash) {
    return NextResponse.json(
      { error: `SKU ${sku} is already in use.` },
      { status: 409 }
    );
  }

  const icon = ICON_KEYS.includes(String(b.icon)) ? String(b.icon) : "gear";

  const imageUrl = String(b.imageUrl || "").trim() || null;

  const product = await prisma.product.create({
    data: {
      sku,
      name,
      category,
      manufacturer,
      icon,
      imageUrl,
      priceCents: dollarsToCents(price),
      unit: String(b.unit || "each"),
      etaDays,
      stock,
      description: String(b.description || "").trim() || `${name} supplied by ${supplier.name}.`,
      specs: b.specs && typeof b.specs === "object" ? b.specs : {},
      supplierId: supplier.id,
      active: true,
    },
  });
  if (imageUrl) {
    await prisma.productImage.create({
      data: { productId: product.id, url: imageUrl, position: 0 },
    });
  }
  return NextResponse.json({ ok: true });
}

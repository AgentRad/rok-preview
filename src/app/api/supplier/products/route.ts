import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { dollarsToCents } from "@/lib/money";
import { ICON_KEYS } from "@/components/PartIcon";
import { canEditCatalog, getActiveSupplierContext } from "@/lib/supplier-access";
import { isClaimedManufacturer } from "@/lib/manufacturers";

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
  // Suppliers must verify their email before listing parts. Read-only
  // access to the dashboard is still allowed; this only gates mutations.
  if (!user.emailVerified && !ctx.actingAsAdmin) {
    return NextResponse.json(
      {
        error:
          "Verify your email before publishing listings. Use the link in your welcome email or request a new one from /account.",
        code: "EMAIL_NOT_VERIFIED",
      },
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

  // P9.5 HIGH 21: parse freight dims on create. Pre-fix the freight
  // fields were silently dropped (the P9 S0 commit only landed the
  // PATCH-side parsing). New products would launch with null dims and
  // need a follow-up PATCH from the supplier just to enable freight
  // quoting. The verify chat caught this as critical for THRADD
  // onboarding (a new supplier's freshly-added SKUs never quoted).
  const parseDim = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const weightLbs = parseDim(b.weightLbs);
  const lengthIn = parseDim(b.lengthIn);
  const widthIn = parseDim(b.widthIn);
  const heightIn = parseDim(b.heightIn);
  const freightClass =
    typeof b.freightClass === "string" && b.freightClass.trim()
      ? b.freightClass.trim().slice(0, 16)
      : null;

  if (!sku || !name || !category || !manufacturer || !(price > 0)) {
    return NextResponse.json(
      { error: "SKU, name, category, manufacturer and a price are required." },
      { status: 400 }
    );
  }
  // PLH-3c F1: soft brand model. Manufacturer must be a claimed OEM
  // on PartsPort. Suppliers cannot mint phantom brands by free-typing
  // a name into the form.
  if (!(await isClaimedManufacturer(manufacturer))) {
    return NextResponse.json(
      {
        error: `"${manufacturer}" is not a brand on PartsPort yet. Ask the brand owner to claim their storefront, or pick from the dropdown.`,
      },
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
      weightLbs,
      lengthIn,
      widthIn,
      heightIn,
      freightClass,
      supplierId: supplier.id,
      active: true,
    },
  });
  if (imageUrl) {
    await prisma.productImage.create({
      data: { productId: product.id, url: imageUrl, ordinal: 0 },
    });
  }
  return NextResponse.json({ ok: true });
}

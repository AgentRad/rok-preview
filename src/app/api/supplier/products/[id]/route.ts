import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { dollarsToCents } from "@/lib/money";
import { canEditCatalog, effectiveAccessToSupplier } from "@/lib/supplier-access";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }
  if (user.role !== "ADMIN") {
    const access = await effectiveAccessToSupplier(user, product.supplierId);
    if (!access.ok) {
      return NextResponse.json({ error: "Not your product." }, { status: 403 });
    }
    if (!canEditCatalog(access.role)) {
      return NextResponse.json(
        { error: "Your role doesn't allow editing the catalog." },
        { status: 403 }
      );
    }
    if (!user.emailVerified) {
      return NextResponse.json(
        {
          error:
            "Verify your email before editing listings. Request a new verification link from /account.",
          code: "EMAIL_NOT_VERIFIED",
        },
        { status: 403 }
      );
    }
  }

  const b = await req.json().catch(() => ({}));
  const data: {
    priceCents?: number;
    stock?: number;
    active?: boolean;
    imageUrl?: string | null;
    weightLbs?: number | null;
    lengthIn?: number | null;
    widthIn?: number | null;
    heightIn?: number | null;
    freightClass?: string | null;
  } = {};
  if (b.price !== undefined && Number(b.price) > 0) {
    data.priceCents = dollarsToCents(Number(b.price));
  }
  if (b.stock !== undefined) {
    data.stock = Math.max(0, Math.floor(Number(b.stock) || 0));
  }
  if (b.active !== undefined) {
    data.active = Boolean(b.active);
  }
  if (b.imageUrl !== undefined) {
    data.imageUrl = String(b.imageUrl || "").trim() || null;
  }
  // Freight inputs: clearable to null when the supplier blanks the field
  // (so they can correct a wrong value), positive numbers otherwise.
  const parseDimUpdate = (v: unknown): number | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const wl = parseDimUpdate(b.weightLbs);
  if (wl !== undefined) data.weightLbs = wl;
  const li = parseDimUpdate(b.lengthIn);
  if (li !== undefined) data.lengthIn = li;
  const wi = parseDimUpdate(b.widthIn);
  if (wi !== undefined) data.widthIn = wi;
  const hi = parseDimUpdate(b.heightIn);
  if (hi !== undefined) data.heightIn = hi;
  if (b.freightClass !== undefined) {
    const fc = typeof b.freightClass === "string" ? b.freightClass.trim() : "";
    data.freightClass = fc || null;
  }
  await prisma.product.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

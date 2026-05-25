import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canEditCatalog,
  getActiveSupplierContext,
} from "@/lib/supplier-access";

export const runtime = "nodejs";

const ZIP_RE = /^\d{5}(-\d{4})?$/;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getActiveSupplierContext(user);
  if (!ctx) {
    return NextResponse.json({ error: "No active supplier." }, { status: 403 });
  }
  const warehouses = await prisma.supplierWarehouse.findMany({
    where: { supplierId: ctx.supplier.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ ok: true, warehouses });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getActiveSupplierContext(user);
  if (!ctx) {
    return NextResponse.json({ error: "No active supplier." }, { status: 403 });
  }
  if (!canEditCatalog(ctx.role) && !ctx.actingAsAdmin) {
    return NextResponse.json(
      { error: "Your role doesn't allow managing warehouses." },
      { status: 403 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const label = String(body.label || "").trim().slice(0, 60);
  const zip = String(body.zip || "").trim();
  const city = String(body.city || "").trim().slice(0, 80);
  const state = String(body.state || "").trim().toUpperCase().slice(0, 2);
  const setDefault = !!body.isDefault;
  if (!ZIP_RE.test(zip)) {
    return NextResponse.json(
      { error: "ZIP must be 5 digits (or 9 with a hyphen)." },
      { status: 400 }
    );
  }
  if (!city || state.length !== 2) {
    return NextResponse.json(
      { error: "City and a 2-letter state code are required." },
      { status: 400 }
    );
  }
  // If caller asks for default, demote any existing default in the same
  // transaction so the supplier never has two simultaneous defaults.
  const created = await prisma.$transaction(async (tx) => {
    const existingCount = await tx.supplierWarehouse.count({
      where: { supplierId: ctx.supplier.id },
    });
    if (setDefault || existingCount === 0) {
      await tx.supplierWarehouse.updateMany({
        where: { supplierId: ctx.supplier.id, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.supplierWarehouse.create({
      data: {
        supplierId: ctx.supplier.id,
        label,
        zip,
        city,
        state,
        // First warehouse is automatically default to avoid an empty
        // "no default" state that would break checkout freight quoting.
        isDefault: setDefault || existingCount === 0,
      },
    });
  });
  return NextResponse.json({ ok: true, warehouse: created });
}

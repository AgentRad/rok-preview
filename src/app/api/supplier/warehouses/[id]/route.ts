import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canEditCatalog,
  effectiveAccessToSupplier,
} from "@/lib/supplier-access";

export const runtime = "nodejs";

/**
 * Per-warehouse operations:
 *   PATCH {isDefault: true}  - mark this warehouse as the supplier default
 *                              (demotes the previous default)
 *   PATCH {label, zip, city, state}  - edit the warehouse details
 *   DELETE                   - remove the warehouse. Refuses when it's
 *                              the only one (supplier needs at least one
 *                              for checkout freight quoting).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const { id } = await params;
  const warehouse = await prisma.supplierWarehouse.findUnique({
    where: { id },
  });
  if (!warehouse) {
    return NextResponse.json({ error: "Warehouse not found." }, { status: 404 });
  }
  const access = await effectiveAccessToSupplier(user, warehouse.supplierId);
  if (!access.ok || !canEditCatalog(access.role)) {
    return NextResponse.json(
      { error: "Not authorized to manage this warehouse." },
      { status: 403 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const data: {
    label?: string;
    zip?: string;
    city?: string;
    state?: string;
  } = {};
  if (typeof body.label === "string") data.label = body.label.trim().slice(0, 60);
  if (typeof body.zip === "string" && /^\d{5}(-\d{4})?$/.test(body.zip.trim())) {
    data.zip = body.zip.trim();
  } else if (body.zip !== undefined) {
    return NextResponse.json(
      { error: "ZIP must be 5 digits (or 9 with a hyphen)." },
      { status: 400 }
    );
  }
  if (typeof body.city === "string") data.city = body.city.trim().slice(0, 80);
  if (typeof body.state === "string") {
    const st = body.state.trim().toUpperCase().slice(0, 2);
    if (st.length === 2) data.state = st;
  }
  if (body.isDefault === true) {
    await prisma.$transaction([
      prisma.supplierWarehouse.updateMany({
        where: { supplierId: warehouse.supplierId, isDefault: true },
        data: { isDefault: false },
      }),
      prisma.supplierWarehouse.update({
        where: { id },
        data: { ...data, isDefault: true },
      }),
    ]);
  } else {
    await prisma.supplierWarehouse.update({ where: { id }, data });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const { id } = await params;
  const warehouse = await prisma.supplierWarehouse.findUnique({
    where: { id },
  });
  if (!warehouse) {
    return NextResponse.json({ error: "Warehouse not found." }, { status: 404 });
  }
  const access = await effectiveAccessToSupplier(user, warehouse.supplierId);
  if (!access.ok || !canEditCatalog(access.role)) {
    return NextResponse.json(
      { error: "Not authorized." },
      { status: 403 }
    );
  }
  const count = await prisma.supplierWarehouse.count({
    where: { supplierId: warehouse.supplierId },
  });
  if (count <= 1) {
    return NextResponse.json(
      {
        error:
          "Suppliers need at least one warehouse for freight quoting. Add a replacement before deleting this one.",
      },
      { status: 400 }
    );
  }
  await prisma.supplierWarehouse.delete({ where: { id } });
  // If we just deleted the default, promote the oldest remaining to default
  // so the supplier doesn't end up with no default.
  if (warehouse.isDefault) {
    const next = await prisma.supplierWarehouse.findFirst({
      where: { supplierId: warehouse.supplierId },
      orderBy: { createdAt: "asc" },
    });
    if (next) {
      await prisma.supplierWarehouse.update({
        where: { id: next.id },
        data: { isDefault: true },
      });
    }
  }
  return NextResponse.json({ ok: true });
}

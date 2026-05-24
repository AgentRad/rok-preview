import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canRunExports, getSupplierContextForUser } from "@/lib/supplier-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function row(cells: unknown[]): string {
  return cells.map(cell).join(",");
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const ctx =
    user.role === "SUPPLIER"
      ? await getSupplierContextForUser(user.id)
      : null;
  if (user.role === "SUPPLIER") {
    if (!ctx) {
      return NextResponse.json(
        { error: "No supplier profile linked to this account." },
        { status: 400 }
      );
    }
    if (!canRunExports(ctx.role)) {
      return NextResponse.json(
        { error: "Your role doesn't allow running exports." },
        { status: 403 }
      );
    }
  }
  const supplier = ctx?.supplier ?? null;

  const orders = await prisma.order.findMany({
    where: {
      ...(supplier
        ? { items: { some: { product: { supplierId: supplier.id } } } }
        : {}),
    },
    include: {
      items: { include: { product: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const header = [
    "Order Reference",
    "Date",
    "Status",
    "Shipment Stage",
    "Carrier",
    "Tracking",
    "Buyer",
    "Email",
    "SKU",
    "Item",
    "Manufacturer",
    "Qty",
    "Unit Price",
    "Line Total",
  ];
  const lines: string[] = [row(header)];

  for (const o of orders) {
    const items = supplier
      ? o.items.filter((i) => i.product.supplierId === supplier.id)
      : o.items;
    for (const it of items) {
      lines.push(
        row([
          o.reference,
          o.createdAt.toISOString().slice(0, 10),
          o.status,
          o.shipmentStage || "",
          o.carrier || "",
          o.trackingCode || "",
          o.buyerName,
          o.buyerEmail,
          it.skuSnapshot,
          it.nameSnapshot,
          it.product.manufacturer,
          it.qty,
          dollars(it.unitPriceCents),
          dollars(it.unitPriceCents * it.qty),
        ])
      );
    }
  }

  const csv = lines.join("\r\n") + "\r\n";
  const today = new Date().toISOString().slice(0, 10);
  const name = supplier ? `partsport-orders-${supplier.name.replace(/\W+/g, "-").toLowerCase()}-${today}.csv` : `partsport-orders-${today}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

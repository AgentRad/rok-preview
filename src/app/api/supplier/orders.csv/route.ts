import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canRunExports, getActiveSupplierContext } from "@/lib/supplier-access";
import { localDateStamp } from "@/lib/date-fns";
import { manufacturerSlug } from "@/lib/manufacturer-slug";
import { csvSafeCell } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PLH-2 Phase 4a (A6): csvSafeCell defangs leading =, +, -, @, TAB, CR.
function cell(v: unknown): string {
  const safe = csvSafeCell(v);
  if (safe.length === 0) return "";
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function row(cells: unknown[]): string {
  return cells.map(cell).join(",");
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  // When the admin is acting as a supplier, scope the export to that supplier
  // too (instead of all orders). Otherwise unscoped for plain admin.
  const ctx = await getActiveSupplierContext(user);
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
  const supplier =
    user.role === "ADMIN"
      ? ctx?.actingAsAdmin
        ? ctx.supplier
        : null
      : (ctx?.supplier ?? null);

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
  const today = localDateStamp(req);
  // Unicode-aware supplier-name slug. The old `replace(/\W+/g, "-")` stripped
  // accents and CJK to empty, producing filenames like "partsport-orders---2026..."
  // The shared manufacturerSlug helper normalizes diacritics first.
  const slug = supplier ? manufacturerSlug(supplier.name) || "supplier" : "";
  const name = supplier
    ? `partsport-orders-${slug}-${today}.csv`
    : `partsport-orders-${today}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

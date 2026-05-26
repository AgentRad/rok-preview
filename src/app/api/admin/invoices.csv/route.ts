import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { localDateStamp } from "@/lib/date-fns";
import { csvSafeCell } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PLH-2 Phase 4a (A6): csvSafeCell defangs leading =, +, -, @, TAB, CR.
function csvCell(value: unknown): string {
  const safe = csvSafeCell(value);
  if (safe.length === 0) return "";
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const invoices = await prisma.invoice.findMany({
    orderBy: { issuedAt: "asc" },
    include: { order: { include: { items: true } } },
  });

  const header = [
    "Invoice No",
    "Customer",
    "Email",
    "Date",
    "Item",
    "SKU",
    "Supplier",
    "Qty",
    "Rate",
    "Amount",
    "Status",
  ];

  const lines: string[] = [csvRow(header)];

  for (const inv of invoices) {
    const date = inv.issuedAt.toISOString().slice(0, 10);
    const items = inv.order.items;

    if (items.length === 0) {
      lines.push(
        csvRow([
          inv.number,
          inv.buyerName,
          inv.buyerEmail,
          date,
          "Order total",
          inv.order.reference,
          "",
          1,
          dollars(inv.totalCents),
          dollars(inv.totalCents),
          inv.status,
        ])
      );
      continue;
    }

    for (const it of items) {
      lines.push(
        csvRow([
          inv.number,
          inv.buyerName,
          inv.buyerEmail,
          date,
          it.nameSnapshot,
          it.skuSnapshot,
          it.supplierName,
          it.qty,
          dollars(it.unitPriceCents),
          dollars(it.unitPriceCents * it.qty),
          inv.status,
        ])
      );
    }

    if (inv.freightCents > 0) {
      lines.push(
        csvRow([
          inv.number,
          inv.buyerName,
          inv.buyerEmail,
          date,
          "Freight",
          "FREIGHT",
          "PartsPort",
          1,
          dollars(inv.freightCents),
          dollars(inv.freightCents),
          inv.status,
        ])
      );
    }

    if (inv.feeCents > 0) {
      lines.push(
        csvRow([
          inv.number,
          inv.buyerName,
          inv.buyerEmail,
          date,
          "PartsPort platform fee",
          "PP-FEE",
          "PartsPort",
          1,
          dollars(inv.feeCents),
          dollars(inv.feeCents),
          inv.status,
        ])
      );
    }

    if (inv.taxCents > 0) {
      lines.push(
        csvRow([
          inv.number,
          inv.buyerName,
          inv.buyerEmail,
          date,
          "Sales tax",
          "SALES-TAX",
          "PartsPort",
          1,
          dollars(inv.taxCents),
          dollars(inv.taxCents),
          inv.status,
        ])
      );
    }
  }

  const csv = lines.join("\r\n") + "\r\n";
  const today = localDateStamp(req);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="partsport-invoices-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

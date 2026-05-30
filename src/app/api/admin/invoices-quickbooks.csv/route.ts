import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { localDateStamp } from "@/lib/date-fns";
import { csvSafeCell } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Polish 12 commit 5 (I): QuickBooks Online "Import Customers and
 * Invoices" template CSV. Admin-only. Pulls PAID Invoice rows and
 * emits one row per Item, matching the column ordering QBO expects.
 *
 * Columns: Invoice No, Customer, Customer Email, Date, Due Date, Item,
 * Qty, Rate, Amount, Tax, Freight, Status.
 */
// PLH-2 Phase 4a (A6): csvSafeCell defangs leading =, +, -, @, TAB, CR so
// the spreadsheet does not evaluate them as formulas when an admin opens
// this file. The CSV quoting below still handles commas, quotes, newlines.
function csvCell(value: unknown): string {
  const safe = csvSafeCell(value);
  if (safe.length === 0) return "";
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
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
    where: { status: "PAID" },
    orderBy: { issuedAt: "asc" },
    include: { order: { include: { items: true } } },
  });

  const header = [
    "Invoice No",
    "Customer",
    "Customer Email",
    "Date",
    "Due Date",
    "Item",
    "Qty",
    "Rate",
    "Amount",
    "Tax",
    "Freight",
    "Status",
  ];
  const lines: string[] = [csvRow(header)];

  for (const inv of invoices) {
    const date = inv.issuedAt.toISOString().slice(0, 10);
    // QuickBooks expects a Due Date column; PartsPort invoices are due
    // on payment (issuedAt == paidAt for PAID rows), so they read as
    // already due. Emitting the same date keeps QBO happy.
    const due = date;
    const items = inv.order.items;
    if (items.length === 0) {
      lines.push(
        csvRow([
          inv.number,
          inv.buyerName,
          inv.buyerEmail,
          date,
          due,
          "Order total",
          1,
          dollars(inv.totalCents),
          dollars(inv.totalCents),
          dollars(inv.taxCents),
          dollars(inv.freightCents),
          inv.status,
        ])
      );
      continue;
    }
    // First line carries the invoice-level Tax + Freight totals so QBO
    // attributes them to the invoice header, not a particular line. The
    // rest of the lines leave those columns blank.
    let firstLine = true;
    for (const it of items) {
      lines.push(
        csvRow([
          inv.number,
          inv.buyerName,
          inv.buyerEmail,
          date,
          due,
          it.nameSnapshot,
          it.qty,
          dollars(it.unitPriceCents),
          dollars(it.unitPriceCents * it.qty),
          firstLine ? dollars(inv.taxCents) : "",
          firstLine ? dollars(inv.freightCents) : "",
          inv.status,
        ])
      );
      firstLine = false;
    }
    if (inv.feeCents > 0) {
      lines.push(
        csvRow([
          inv.number,
          inv.buyerName,
          inv.buyerEmail,
          date,
          due,
          "PartsPort platform fee",
          1,
          dollars(inv.feeCents),
          dollars(inv.feeCents),
          "",
          "",
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
      "Content-Disposition": `attachment; filename="partsport-quickbooks-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

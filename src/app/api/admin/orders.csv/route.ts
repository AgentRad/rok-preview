import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { localDateStamp } from "@/lib/date-fns";
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
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const orders = await prisma.order.findMany({
    include: { items: true },
    orderBy: { createdAt: "asc" },
  });

  const header = [
    "Order Reference",
    "Date Placed",
    "Date Paid",
    "Status",
    "Shipment Stage",
    "Carrier",
    "Tracking",
    "Buyer",
    "Email",
    "Ship To",
    "Items",
    "Subtotal",
    "Freight",
    "Platform Fee",
    "Sales Tax",
    "Total",
  ];
  const lines: string[] = [row(header)];

  for (const o of orders) {
    const itemSummary = o.items
      .map((i) => `${i.qty} x ${i.skuSnapshot}`)
      .join("; ");
    lines.push(
      row([
        o.reference,
        o.createdAt.toISOString().slice(0, 10),
        o.paidAt ? o.paidAt.toISOString().slice(0, 10) : "",
        o.status,
        o.shipmentStage || "",
        o.carrier || "",
        o.trackingCode || "",
        o.buyerName,
        o.buyerEmail,
        o.shipTo.replace(/\s+/g, " ").trim(),
        itemSummary,
        dollars(o.subtotalCents),
        dollars(o.freightCents),
        dollars(o.feeCents),
        dollars(o.taxCents),
        dollars(o.totalCents),
      ])
    );
  }

  const csv = lines.join("\r\n") + "\r\n";
  const today = localDateStamp(req);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="partsport-orders-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

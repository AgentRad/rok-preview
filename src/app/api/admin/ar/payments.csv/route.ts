import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { csvSafeCell } from "@/lib/csv";
import { localDateStamp } from "@/lib/date-fns";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/**
 * PLH-3z-3 (section 5.6): every PaymentRecord in a date range, for accounting
 * reconciliation. Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD (receivedAt range);
 * defaults to all records. csvSafeCell-guarded per PLH-2 4a.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const where: { receivedAt?: { gte?: Date; lte?: Date } } = {};
  if (fromStr || toStr) {
    where.receivedAt = {};
    if (fromStr) {
      const d = new Date(fromStr);
      if (!Number.isNaN(d.getTime())) where.receivedAt.gte = d;
    }
    if (toStr) {
      const d = new Date(toStr);
      if (!Number.isNaN(d.getTime())) where.receivedAt.lte = d;
    }
  }

  const payments = await prisma.paymentRecord.findMany({
    where,
    include: {
      invoice: {
        select: {
          number: true,
          order: {
            select: { reference: true, buyerOrg: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { receivedAt: "asc" },
  });

  const header = [
    "Received",
    "Invoice",
    "Order",
    "Organization",
    "Amount",
    "Method",
    "Reference",
    "Source",
    "Notes",
  ];
  const lines = [row(header)];
  for (const p of payments) {
    lines.push(
      row([
        p.receivedAt.toISOString().slice(0, 10),
        p.invoice.number,
        p.invoice.order.reference,
        p.invoice.order.buyerOrg?.name ?? "",
        dollars(p.amountCents),
        p.method,
        p.reference,
        p.source,
        p.notes,
      ])
    );
  }

  await writeAuditLog({
    actor: user,
    action: "BUYER_ORG_ORDERS_EXPORTED",
    targetType: "Invoice",
    targetId: "ar-payments",
    summary: `Exported ${payments.length} payment records (A/R)`,
    metadata: { paymentCount: payments.length, from: fromStr, to: toStr },
  });

  const csv = lines.join("\r\n") + "\r\n";
  const name = `partsport-ar-payments-${localDateStamp(req)}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

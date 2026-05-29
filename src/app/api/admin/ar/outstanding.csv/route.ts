import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { csvSafeCell } from "@/lib/csv";
import { localDateStamp } from "@/lib/date-fns";
import { writeAuditLog } from "@/lib/audit";
import { daysPastDue } from "@/lib/accounts-receivable";

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

const UNPAID = ["DUE", "PAST_DUE"] as const;

/**
 * PLH-3z-3 (section 5.6): every unpaid invoice with org, amounts, dates, and
 * AP contact info. csvSafeCell-guarded per PLH-2 4a.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const now = new Date();

  const invoices = await prisma.invoice.findMany({
    where: { status: { in: [...UNPAID] } },
    select: {
      number: true,
      status: true,
      issuedAt: true,
      dueDate: true,
      totalCents: true,
      partialPaidCents: true,
      buyerName: true,
      buyerEmail: true,
      order: {
        select: {
          reference: true,
          invoiceDueDate: true,
          buyerOrg: { select: { name: true } },
        },
      },
    },
    orderBy: { issuedAt: "asc" },
  });

  const header = [
    "Invoice",
    "Order",
    "Organization",
    "Buyer",
    "Email",
    "Issued",
    "Due",
    "Days past due",
    "Total",
    "Partial paid",
    "Outstanding",
    "Status",
  ];
  const lines = [row(header)];
  for (const i of invoices) {
    const due = i.dueDate ?? i.order.invoiceDueDate ?? null;
    const past = daysPastDue(due, now);
    const outstanding = Math.max(0, i.totalCents - i.partialPaidCents);
    lines.push(
      row([
        i.number,
        i.order.reference,
        i.order.buyerOrg?.name ?? "",
        i.buyerName,
        i.buyerEmail,
        i.issuedAt.toISOString().slice(0, 10),
        due ? due.toISOString().slice(0, 10) : "",
        past > 0 ? past : 0,
        dollars(i.totalCents),
        dollars(i.partialPaidCents),
        dollars(outstanding),
        i.status,
      ])
    );
  }

  await writeAuditLog({
    actor: user,
    action: "BUYER_ORG_ORDERS_EXPORTED",
    targetType: "Invoice",
    targetId: "ar-outstanding",
    summary: `Exported ${invoices.length} outstanding invoices (A/R)`,
    metadata: { invoiceCount: invoices.length },
  });

  const csv = lines.join("\r\n") + "\r\n";
  const name = `partsport-ar-outstanding-${localDateStamp(req)}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

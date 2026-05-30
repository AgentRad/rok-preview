import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { csvSafeCell } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PLH-2 Phase 4a (A6): csvSafeCell prefix defangs leading =, +, -, @,
// TAB, CR so spreadsheets do not evaluate them as formulas.
function csvEscape(value: string | number | null | undefined): string {
  const safe = csvSafeCell(value);
  if (safe.length === 0) return "";
  if (safe.includes(",") || safe.includes("\"") || safe.includes("\n")) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function parseRegionFromShipTo(shipTo: string): string {
  // shipTo is a free-form string: best-effort regex pulls "ST 12345"
  // out of the trailing slug. Falls back to "UNKNOWN" so the row is
  // still aggregated somewhere, not silently dropped.
  const match = shipTo.match(/\b([A-Z]{2})\s+\d{5}/);
  return match ? match[1] : "UNKNOWN";
}

/**
 * Period-bounded tax report. ?period=YYYY-MM (defaults to current
 * month). One row per paid Order, columns suitable for handing to an
 * accountant to file state-by-state sales tax returns.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const url = new URL(req.url);
  const period =
    url.searchParams.get("period") || new Date().toISOString().slice(0, 7);
  const match = period.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return NextResponse.json(
      { error: "period must be YYYY-MM." },
      { status: 400 }
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["PAID", "FULFILLED", "REFUNDED"] },
      paidAt: { gte: start, lt: end },
    },
    orderBy: { paidAt: "asc" },
  });

  const lines: string[] = [
    [
      "order_reference",
      "paid_at",
      "state",
      "ship_to",
      "subtotal_cents",
      "freight_cents",
      "fee_cents",
      "tax_cents",
      "total_cents",
      "refunded_cents",
      "buyer_email",
      "buyer_company",
    ]
      .map(csvEscape)
      .join(","),
  ];
  for (const o of orders) {
    lines.push(
      [
        o.reference,
        o.paidAt ? o.paidAt.toISOString() : "",
        parseRegionFromShipTo(o.shipTo),
        o.shipTo,
        o.subtotalCents,
        o.freightCents,
        o.feeCents,
        o.taxCents,
        o.totalCents,
        o.refundedCents,
        o.buyerEmail,
        o.buyerCompanyName || "",
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  const body = lines.join("\n") + "\n";
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="partsport-tax-report-${period}.csv"`,
    },
  });
}

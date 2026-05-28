import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { csvSafeCell } from "@/lib/csv";
import { localDateStamp } from "@/lib/date-fns";
import { manufacturerSlug } from "@/lib/manufacturer-slug";
import { writeAuditLog } from "@/lib/audit";
import {
  getActiveBuyerOrgContext,
  canSeeAllOrgOrders,
} from "@/lib/buyer-org-access";

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

/**
 * PLH-3y-2: ADMIN export of all org orders as CSV. Membership-based scope
 * (orders placed by current members of the active org). Uses the csvSafeCell
 * formula-injection guard from PLH-2 4a.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx || !canSeeAllOrgOrders(ctx.role)) {
    return NextResponse.json(
      { error: "Only an organization admin can export org orders." },
      { status: 403 }
    );
  }

  const members = await prisma.buyerOrgMember.findMany({
    where: { buyerOrgId: ctx.org.id },
    select: { userId: true },
  });
  const memberIds = members.map((m) => m.userId);

  const orders = await prisma.order.findMany({
    where: { buyerId: { in: memberIds } },
    include: { items: { select: { qty: true } } },
    orderBy: { createdAt: "asc" },
  });

  const header = [
    "Order Reference",
    "Date",
    "Status",
    "Buyer",
    "Email",
    "PO Number",
    "Items",
    "Subtotal",
    "Freight",
    "Fee",
    "Tax",
    "Total",
  ];
  const lines: string[] = [row(header)];
  for (const o of orders) {
    lines.push(
      row([
        o.reference,
        o.createdAt.toISOString().slice(0, 10),
        o.status,
        o.buyerName,
        o.buyerEmail,
        o.purchaseOrderNumber || "",
        o.items.reduce((n, i) => n + i.qty, 0),
        dollars(o.subtotalCents),
        dollars(o.freightCents),
        dollars(o.feeCents),
        dollars(o.taxCents),
        dollars(o.totalCents),
      ])
    );
  }

  await writeAuditLog({
    actor: user,
    action: "BUYER_ORG_ORDERS_EXPORTED",
    targetType: "BuyerOrg",
    targetId: ctx.org.id,
    summary: `Exported ${orders.length} org orders for ${ctx.org.name}`,
    metadata: { orderCount: orders.length },
  });

  const csv = lines.join("\r\n") + "\r\n";
  const today = localDateStamp(req);
  const slug = manufacturerSlug(ctx.org.name) || "org";
  const name = `partsport-org-orders-${slug}-${today}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

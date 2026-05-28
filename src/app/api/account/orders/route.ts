import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  getActiveBuyerOrgContext,
  canSeeAllOrgOrders,
} from "@/lib/buyer-org-access";

export const runtime = "nodejs";

const PAGE_SIZE = 25;
const MAX_PAGE = 200;

/**
 * PLH-3j P10: paginated buyer order history. Used by OrderHistoryTable
 * on /account to lazy-load pages beyond the initial 25.
 *
 * Auth: buyer-scoped via session. The where clause pins to the calling
 * user's id, so a session forgery on the page=N param cannot leak
 * someone else's orders.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const url = new URL(req.url);
  const rawPage = Number.parseInt(url.searchParams.get("page") || "1", 10);
  const page = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), MAX_PAGE) : 1;
  const skip = (page - 1) * PAGE_SIZE;
  // PLH-3v: optional substring search on purchaseOrderNumber. Capped at
  // 64 chars to match the indexed column; case-insensitive contains.
  const q = (url.searchParams.get("q") || "").trim().slice(0, 64);

  // PLH-3y-2: an org ADMIN can scope to all orders placed by current members
  // of their active org. The org scope is membership-based (orders whose buyer
  // is a current member); non-admins or non-org requests fall back to own.
  const scope = url.searchParams.get("scope");
  let orgScoped = false;
  let buyerWhere: Prisma.OrderWhereInput = { buyerId: user.id };
  if (scope === "org") {
    const ctx = await getActiveBuyerOrgContext(user);
    if (ctx && canSeeAllOrgOrders(ctx.role)) {
      const members = await prisma.buyerOrgMember.findMany({
        where: { buyerOrgId: ctx.org.id },
        select: { userId: true },
      });
      buyerWhere = { buyerId: { in: members.map((m) => m.userId) } };
      orgScoped = true;
    }
  }

  const where: Prisma.OrderWhereInput = q
    ? { ...buyerWhere, purchaseOrderNumber: { contains: q, mode: "insensitive" } }
    : buyerWhere;
  const orders = await prisma.order.findMany({
    where,
    include: { items: { select: { qty: true } } },
    orderBy: { createdAt: "desc" },
    skip,
    take: PAGE_SIZE,
  });
  return NextResponse.json({
    page,
    pageSize: PAGE_SIZE,
    orgScoped,
    orders: orders.map((o) => ({
      id: o.id,
      reference: o.reference,
      createdAt: o.createdAt.toISOString(),
      status: o.status,
      totalCents: o.totalCents,
      qtyTotal: o.items.reduce((n, i) => n + i.qty, 0),
      purchaseOrderNumber: o.purchaseOrderNumber,
      buyerName: o.buyerName,
    })),
  });
}

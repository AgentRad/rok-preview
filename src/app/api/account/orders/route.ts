import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

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
  const where = q
    ? {
        buyerId: user.id,
        purchaseOrderNumber: { contains: q, mode: "insensitive" as const },
      }
    : { buyerId: user.id };
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
    orders: orders.map((o) => ({
      id: o.id,
      reference: o.reference,
      createdAt: o.createdAt.toISOString(),
      status: o.status,
      totalCents: o.totalCents,
      qtyTotal: o.items.reduce((n, i) => n + i.qty, 0),
      purchaseOrderNumber: o.purchaseOrderNumber,
    })),
  });
}

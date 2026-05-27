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
  const orders = await prisma.order.findMany({
    where: { buyerId: user.id },
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
    })),
  });
}

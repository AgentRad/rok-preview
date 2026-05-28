import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getActiveBuyerOrgContext, canApproveOrders } from "@/lib/buyer-org-access";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const PAGE_SIZE = 25;

/**
 * PLH-3y-6 C3: list pending approval orders for the active org.
 * ?status=PENDING (default) | APPROVED | REJECTED | AUTO_APPROVED
 * ?page=N (1-based)
 */
export async function GET(req: Request) {
  const user = await requireUser();
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx || !canApproveOrders(ctx.role)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "PENDING";
  const rawPage = Number.parseInt(url.searchParams.get("page") || "1", 10);
  const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;

  const orders = await prisma.order.findMany({
    where: {
      buyerOrgId: ctx.org.id,
      approvalStatus: status,
    },
    include: {
      approvals: {
        orderBy: { chainOrder: "asc" },
        select: {
          id: true,
          outcome: true,
          approverMemberId: true,
          chainOrder: true,
          reason: true,
          decidedAt: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
  });

  const hasMore = orders.length > PAGE_SIZE;
  const slice = hasMore ? orders.slice(0, PAGE_SIZE) : orders;

  return NextResponse.json({
    page,
    hasMore,
    status,
    orders: slice.map((o) => ({
      id: o.id,
      reference: o.reference,
      buyerName: o.buyerName,
      buyerEmail: o.buyerEmail,
      totalCents: o.totalCents,
      createdAt: o.createdAt.toISOString(),
      approvalStatus: o.approvalStatus,
      approvals: o.approvals,
    })),
  });
}

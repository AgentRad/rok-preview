import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getActiveBuyerOrgContext, canApproveOrders } from "@/lib/buyer-org-access";
import { advanceApproval } from "@/lib/approval";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const MAX_BULK = 50;

/**
 * PLH-3y-6 C3: bulk approve up to 50 pending orders in one request.
 * Body: { orderIds: string[] }
 * Only APPROVE is supported for bulk (reject requires a reason per order).
 */
export async function POST(req: Request) {
  const user = await requireUser();
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx || !canApproveOrders(ctx.role)) {
    return NextResponse.json({ error: "Not authorized to approve orders." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const raw: unknown[] = Array.isArray(body.orderIds) ? body.orderIds : [];
  const orderIds = raw
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, MAX_BULK);

  if (orderIds.length === 0) {
    return NextResponse.json({ error: "orderIds is required and must be a non-empty array." }, { status: 400 });
  }

  const member = await prisma.buyerOrgMember.findUnique({
    where: { buyerOrgId_userId: { buyerOrgId: ctx.org.id, userId: user.id } },
    select: { id: true },
  });
  if (!member) {
    return NextResponse.json({ error: "Not a member of this org." }, { status: 403 });
  }

  const results: { orderId: string; status: string; error?: string }[] = [];
  for (const orderId of orderIds) {
    const outcome = await advanceApproval({
      orderId,
      deciderMemberId: member.id,
      decision: "APPROVE",
    });
    if (outcome && typeof outcome === "object" && "error" in outcome) {
      results.push({ orderId, status: "skipped", error: outcome.error });
    } else if (outcome) {
      results.push({ orderId, status: outcome });
    } else {
      results.push({ orderId, status: "skipped", error: "Not actionable or not authorized." });
    }
  }

  return NextResponse.json({ ok: true, results });
}

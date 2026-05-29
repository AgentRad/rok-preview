import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { markOrderPaid } from "@/lib/order-utils";
import { isPaymentsConfigured } from "@/lib/payments";
import { getCurrentUser } from "@/lib/auth";
import { getActiveBuyerOrgContext } from "@/lib/buyer-org-access";
import { demoPayGuard } from "@/lib/route-guards";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // BUG 1 fix. This demo-pay path settles an order to PAID for free (no money
  // moves, but stock decrements, an invoice is generated, and real Stripe
  // supplier payouts fire). It must be completely inert once a real payment
  // provider is live, and otherwise gated behind auth + ownership + status +
  // the same approval / org-suspension gates create-session enforces. See
  // demoPayGuard in src/lib/route-guards.ts.
  const paymentsConfigured = isPaymentsConfigured();

  // Skip DB / session work when payments are configured: the route is inert.
  if (paymentsConfigured) {
    const r = demoPayGuard({ paymentsConfigured, user: null, order: null, orgStatus: null });
    // r is always the 503 here.
    return NextResponse.json({ error: (r as { error: string }).error }, { status: 503 });
  }

  const user = await getCurrentUser();
  // Load the order with its buyer. Demo mode supports guest orders (buyerId
  // null), which a guest must be able to pay, so we cannot gate the lookup
  // behind a session. demoPayGuard enforces auth/ownership for a real user's
  // order; a guest order is allowed through (demo-only, no real money moves).
  const order = await prisma.order.findUnique({
    where: { id },
    include: { buyer: true },
  });
  // BUG 2 fix. The org-suspend gate must read the ORDER's buyer's org (mirrors
  // create-session's getActiveBuyerOrgContext(order.buyer)), NOT the current
  // session user's org. Otherwise an admin paying on behalf of a buyer whose
  // org is suspended would read the admin's (un-suspended) org and slip past.
  // A guest order (buyerId null, no buyer) has no org, so no org-suspend check.
  const orgCtx = order?.buyer
    ? await getActiveBuyerOrgContext(order.buyer)
    : null;

  const result = demoPayGuard({
    paymentsConfigured,
    user,
    order,
    orgStatus: orgCtx?.org.status ?? null,
  });
  if (!result.ok) {
    return NextResponse.json(
      result.code ? { error: result.error, code: result.code } : { error: result.error },
      { status: result.status }
    );
  }

  await markOrderPaid(id, "demo");
  return NextResponse.json({ ok: true });
}

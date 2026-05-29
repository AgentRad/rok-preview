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
  // Only load the order + org context once we have a user (avoids leaking
  // order existence to unauthenticated callers and saves the queries).
  const order = user
    ? await prisma.order.findUnique({ where: { id } })
    : null;
  const orgCtx = user ? await getActiveBuyerOrgContext(user) : null;

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

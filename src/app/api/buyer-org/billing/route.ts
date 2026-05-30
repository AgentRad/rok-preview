import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { createStripeCustomer } from "@/lib/payments";
import {
  getActiveBuyerOrgContext,
  canManageBuyerOrg,
} from "@/lib/buyer-org-access";

export const runtime = "nodejs";

/**
 * PLH-3y-2: an org ADMIN sets the org billing mode. Switching to HYBRID
 * lazily creates an org-level Stripe Customer (when Stripe is configured) so
 * permitted members can charge the org card at checkout. Switching back to
 * MEMBER_PAYS leaves the customer in place (re-enabling HYBRID reuses it).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx || !canManageBuyerOrg(ctx.role)) {
    return NextResponse.json(
      { error: "Only an organization admin can change billing settings." },
      { status: 403 }
    );
  }
  const rl = await rateLimit("generic", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const mode = String(body.billingMode || "").toUpperCase();
  if (mode !== "MEMBER_PAYS" && mode !== "HYBRID") {
    return NextResponse.json(
      { error: "billingMode must be MEMBER_PAYS or HYBRID." },
      { status: 400 }
    );
  }

  let stripeCustomerId = ctx.org.stripeCustomerId;
  let customerCreated = false;
  if (mode === "HYBRID" && !stripeCustomerId) {
    const created = await createStripeCustomer({
      name: ctx.org.name,
      email: user.email,
      buyerOrgId: ctx.org.id,
    });
    if (!created) {
      return NextResponse.json(
        {
          error:
            "Centralized billing needs Stripe configured on this environment. Add STRIPE_SECRET_KEY, then enable HYBRID.",
        },
        { status: 503 }
      );
    }
    stripeCustomerId = created;
    customerCreated = true;
  }

  await prisma.buyerOrg.update({
    where: { id: ctx.org.id },
    data: { billingMode: mode, stripeCustomerId },
  });

  if (customerCreated) {
    await writeAuditLog({
      actor: user,
      action: "BUYER_ORG_STRIPE_CUSTOMER_CREATED",
      targetType: "BuyerOrg",
      targetId: ctx.org.id,
      summary: `Created org Stripe Customer for ${ctx.org.name}`,
      metadata: { stripeCustomerId },
    });
  }
  await writeAuditLog({
    actor: user,
    action: "BUYER_ORG_BILLING_MODE_CHANGED",
    targetType: "BuyerOrg",
    targetId: ctx.org.id,
    summary: `Billing mode set to ${mode} for ${ctx.org.name}`,
    metadata: { billingMode: mode },
  });

  return NextResponse.json({
    ok: true,
    billingMode: mode,
    hasStripeCustomer: !!stripeCustomerId,
  });
}

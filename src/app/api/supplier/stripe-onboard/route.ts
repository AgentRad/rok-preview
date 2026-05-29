import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  canManageBankInfo,
  getActiveSupplierContext,
} from "@/lib/supplier-access";
import {
  createOnboardingLink,
  isStripeConnectConfigured,
} from "@/lib/stripe-connect";
import { captureError } from "@/lib/observability";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Start a Stripe Connect Express onboarding session. Idempotent: returns
 * a fresh account-link URL on every call so an expired link can be
 * refreshed by the supplier from the dashboard.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  // PLH-1 commit 4: two-bucket throttle. The generic bucket catches
  // bursts (60 calls/min across all supplier mutations); the dedicated
  // stripe-connect bucket caps total onboarding-link creation at
  // 5/hour/supplier so a wedged client can't burn through Stripe API
  // quota.
  const genericRl = await rateLimit("generic", `supplier:${user.id}`);
  if (!genericRl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(genericRl.retryAfterMs / 1000)) } }
    );
  }
  const connectRl = await rateLimit("stripe-connect", `supplier:${user.id}`);
  if (!connectRl.allowed) {
    return NextResponse.json(
      {
        error:
          "Too many Stripe onboarding attempts. Wait an hour, or contact support if you're stuck.",
      },
      { status: 429, headers: { "Retry-After": String(Math.ceil(connectRl.retryAfterMs / 1000)) } }
    );
  }
  const ctx = await getActiveSupplierContext(user);
  if (!ctx) {
    return NextResponse.json({ error: "No active supplier." }, { status: 403 });
  }
  if (!canManageBankInfo(ctx.role) && !ctx.actingAsAdmin) {
    return NextResponse.json(
      { error: "Only the supplier owner or an admin can set up payouts." },
      { status: 403 }
    );
  }
  if (!isStripeConnectConfigured()) {
    return NextResponse.json(
      {
        error:
          "Payouts via Stripe Connect aren't enabled on this deployment yet. Ask an admin to set STRIPE_SECRET_KEY in Vercel.",
      },
      { status: 503 }
    );
  }
  try {
    const url = await createOnboardingLink(ctx.supplier);
    if (!url) {
      return NextResponse.json(
        { error: "Stripe did not return an onboarding URL. Try again." },
        { status: 502 }
      );
    }
    // QA2 BUG 1: a Connect onboarding link can redirect the payout
    // destination, so it is audited like a bank-info change, and the row
    // records whether an admin minted it while impersonating this supplier.
    await writeAuditLog({
      actor: user,
      action: "SUPPLIER_CONNECT_ONBOARD_LINK_CREATED",
      targetType: "Supplier",
      targetId: ctx.supplier.id,
      summary: `Stripe Connect onboarding link created for ${ctx.supplier.name}`,
      metadata: {
        actor: user.id,
        actingAsAdmin: ctx.actingAsAdmin === true,
        ...(ctx.actingAsAdmin
          ? { impersonatedSupplierId: ctx.supplier.id }
          : {}),
      },
    });
    return NextResponse.json({ ok: true, url });
  } catch (err) {
    captureError(err, {
      subsystem: "stripe-connect",
      op: "onboard",
      supplierId: ctx.supplier.id,
    });
    return NextResponse.json(
      {
        error:
          "Could not start Stripe onboarding. The error has been logged for admin review.",
      },
      { status: 502 }
    );
  }
}

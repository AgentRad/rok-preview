import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  canManageBankInfo,
  getActiveSupplierContext,
} from "@/lib/supplier-access";
import { syncSupplierConnectStatus } from "@/lib/stripe-connect";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * Force-sync the supplier's Connect status from Stripe. Useful when the
 * webhook lag is visible or the supplier returns to the dashboard
 * mid-onboarding and wants to see fresh state without waiting.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getActiveSupplierContext(user);
  if (!ctx) {
    return NextResponse.json({ error: "No active supplier." }, { status: 403 });
  }
  if (!canManageBankInfo(ctx.role) && !ctx.actingAsAdmin) {
    return NextResponse.json(
      { error: "Only the supplier owner or an admin can sync payout status." },
      { status: 403 }
    );
  }
  try {
    const updated = await syncSupplierConnectStatus(ctx.supplier.id);
    if (!updated) {
      return NextResponse.json(
        { ok: true, accountId: ctx.supplier.stripeAccountId, synced: false },
        { status: 200 }
      );
    }
    return NextResponse.json({
      ok: true,
      accountId: updated.stripeAccountId,
      chargesEnabled: updated.stripeChargesEnabled,
      payoutsEnabled: updated.stripePayoutsEnabled,
      onboardingCompletedAt: updated.stripeOnboardingCompletedAt,
    });
  } catch (err) {
    captureError(err, {
      subsystem: "stripe-connect",
      op: "refresh",
      supplierId: ctx.supplier.id,
    });
    return NextResponse.json(
      { error: "Could not refresh status." },
      { status: 502 }
    );
  }
}

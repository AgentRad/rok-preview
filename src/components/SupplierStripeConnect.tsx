"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ConnectView = {
  configured: boolean;
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  active: boolean;
  pending: boolean;
};

/**
 * Supplier dashboard view of Stripe Connect Express. Three states:
 *   - Not connected   -> "Connect bank via Stripe" button
 *   - Pending         -> status note + resume button
 *   - Active          -> green check + a refresh button for status drift
 *
 * Replaces the legacy "Bank info" form from P6. The legacy fields remain
 * on the Supplier row for audit but no longer drive the onboarding gate.
 */
export default function SupplierStripeConnect({
  initial,
  successFlag,
  refreshFlag,
}: {
  initial: ConnectView;
  /** True when ?stripeOnboard=done is in the URL after Stripe redirect. */
  successFlag?: boolean;
  /** True when ?stripeOnboard=refresh - the supplier bailed mid-flow. */
  refreshFlag?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"onboard" | "refresh" | null>(null);
  const [error, setError] = useState("");

  async function startOnboarding() {
    setBusy("onboard");
    setError("");
    try {
      const res = await fetch("/api/supplier/stripe-onboard", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setError(data.error || "Could not start Stripe onboarding.");
        setBusy(null);
        return;
      }
      // Redirect to Stripe-hosted onboarding. Stripe sends the supplier
      // back to /supplier?stripeOnboard=done on success or =refresh on
      // session expiry.
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setBusy(null);
    }
  }

  async function refreshStatus() {
    setBusy("refresh");
    setError("");
    try {
      const res = await fetch("/api/supplier/stripe-refresh", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not refresh status.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!initial.configured) {
    return (
      <div className="alert alert-info">
        Stripe Connect isn&rsquo;t enabled on this deployment yet. Once an
        admin sets <code>STRIPE_SECRET_KEY</code> in Vercel, you&rsquo;ll
        be able to connect your bank to receive payouts. Until then you can
        complete the rest of onboarding; payouts wire up on the next
        deploy.
      </div>
    );
  }

  return (
    <div>
      {successFlag && (
        <div className="alert alert-ok" style={{ marginBottom: 12 }}>
          <strong>Stripe onboarding submitted.</strong> Status updates may
          take a minute to land. Click Refresh status below to pull the
          latest state.
        </div>
      )}
      {refreshFlag && (
        <div className="alert alert-info" style={{ marginBottom: 12 }}>
          Your Stripe onboarding session expired. Start it again to
          continue where you left off.
        </div>
      )}

      {!initial.accountId && (
        <div>
          <p className="muted-text" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            PartsPort uses Stripe Connect for payouts so we never touch
            your bank or routing numbers. Stripe collects your business
            details, runs identity verification, and issues you a 1099-K
            at year end automatically when you cross $600 in earnings.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy === "onboard"}
            onClick={startOnboarding}
            style={{ marginTop: 12 }}
          >
            {busy === "onboard" ? "Redirecting…" : "Connect bank via Stripe"}
          </button>
        </div>
      )}

      {initial.accountId && initial.active && (
        <div>
          <div className="alert alert-ok">
            <strong>Active.</strong> Payouts are wired up. Transfers land
            in your bank automatically when an order is marked shipped.
          </div>
          <div
            className="muted-text"
            style={{ fontSize: 12.5, marginTop: 8 }}
          >
            Stripe account: <code>{initial.accountId}</code>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={refreshStatus}
            disabled={busy === "refresh"}
            style={{ marginTop: 10 }}
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh status"}
          </button>
        </div>
      )}

      {initial.accountId && initial.pending && (
        <div>
          <div className="alert alert-info">
            <strong>Pending Stripe verification.</strong> Stripe is still
            reviewing your details
            {initial.chargesEnabled ? " (charges enabled)" : ""}. You can
            resume the flow below.
          </div>
          <div
            className="muted-text"
            style={{ fontSize: 12.5, marginTop: 8 }}
          >
            Stripe account: <code>{initial.accountId}</code>
          </div>
          <div className="row-gap" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy === "onboard"}
              onClick={startOnboarding}
            >
              {busy === "onboard" ? "Redirecting…" : "Resume onboarding"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={refreshStatus}
              disabled={busy === "refresh"}
            >
              {busy === "refresh" ? "Refreshing…" : "Refresh status"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
    </div>
  );
}

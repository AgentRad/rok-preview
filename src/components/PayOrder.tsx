"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { formatCents } from "@/lib/money";

type Props = {
  orderId: string;
  totalCents: number;
  paypalClientId: string;
  paymentsConfigured: boolean;
};

export default function PayOrder({
  orderId,
  totalCents,
  paypalClientId,
  paymentsConfigured,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // When Stripe is configured but the create-session call fails (network,
  // upstream Stripe error, mis-configured key), the buyer would otherwise
  // be stranded with no path forward. Showing the demo-checkout fallback
  // keeps the order completable while we investigate upstream.
  const [stripeFailed, setStripeFailed] = useState(false);

  async function payDemo() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/orders/${orderId}/pay`, { method: "POST" });
    if (!res.ok) {
      setError("Payment failed. Try again.");
      setBusy(false);
      return;
    }
    router.refresh();
  }

  async function payHosted() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/payments/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setError(data.error || "Could not start hosted checkout.");
        setStripeFailed(true);
        setBusy(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Could not reach the payment provider.");
      setStripeFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-head">
        <h2>Payment</h2>
      </div>
      <div className="card-body">
        {error && <div className="alert alert-error">{error}</div>}
        <div className="pay-note">
          PartsPort collects payment, then releases funds to the supplier on
          dispatch. The marketplace fee is included in the total.
        </div>
        {paymentsConfigured ? (
          <>
            <button
              className="btn btn-primary btn-block"
              onClick={payHosted}
              disabled={busy}
            >
              {busy ? "Starting checkout…" : `Pay by bank transfer or card · ${formatCents(totalCents)}`}
            </button>
            <p className="muted-text" style={{ fontSize: 12.5, marginTop: 8 }}>
              Continues to a secure hosted checkout. ACH bank transfer is the
              default; card is available as a fallback.
            </p>
            {stripeFailed && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                <p className="muted-text" style={{ fontSize: 12.5, marginBottom: 8 }}>
                  Card / ACH checkout had a hiccup. As a backup, you can place
                  the order through our demo settlement path and we&rsquo;ll
                  reconcile payment manually.
                </p>
                <button
                  className="btn btn-ghost btn-sm btn-block"
                  onClick={payDemo}
                  disabled={busy}
                >
                  {busy ? "Processing…" : `Try demo checkout · ${formatCents(totalCents)}`}
                </button>
              </div>
            )}
          </>
        ) : paypalClientId ? (
          <PayPalScriptProvider options={{ clientId: paypalClientId, currency: "USD" }}>
            <PayPalButtons
              style={{ layout: "vertical", color: "gold", shape: "rect" }}
              createOrder={async () => {
                const r = await fetch("/api/paypal/create-order", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ orderId }),
                });
                const d = await r.json();
                if (!r.ok) throw new Error(d.error);
                return d.paypalOrderId as string;
              }}
              onApprove={async () => {
                const r = await fetch("/api/paypal/capture", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ orderId }),
                });
                if (!r.ok) {
                  setError("Payment could not be captured.");
                  return;
                }
                router.refresh();
              }}
              onError={() => setError("PayPal checkout failed. Try again.")}
            />
          </PayPalScriptProvider>
        ) : (
          <>
            <div className="alert alert-info">
              Instant settlement is enabled for this environment. Connect a
              real payment processor to accept live payments.
            </div>
            <button
              className="btn btn-primary btn-block"
              onClick={payDemo}
              disabled={busy}
            >
              {busy ? "Processing…" : `Place order · ${formatCents(totalCents)}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

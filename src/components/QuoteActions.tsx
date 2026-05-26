"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Polish 12 C1+C2: accept now requires owner session or guest email
 * match. For guests, this widget exposes an inline email confirmation
 * field. On success the route returns a redirect URL, which is either
 * the order page (legacy accepted quotes) or the new
 * /checkout-from-quote/[id] bridge where shipping + freight + Stripe
 * Tax are collected before payment.
 */
export default function QuoteActions({
  quoteId,
  isOwner,
  buyerEmailHint,
}: {
  quoteId: string;
  isOwner: boolean;
  buyerEmailHint?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");

  async function accept() {
    setBusy("accept");
    setError("");
    const payload: Record<string, string> = {};
    if (!isOwner && email.trim()) payload.email = email.trim();
    const res = await fetch(`/api/quotes/${quoteId}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Could not accept the quote.");
      setBusy("");
      return;
    }
    if (data.redirect) {
      router.push(data.redirect);
      return;
    }
    if (data.orderId) {
      router.push(`/orders/${data.orderId}`);
      return;
    }
    router.refresh();
  }

  async function decline() {
    setBusy("decline");
    await fetch(`/api/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "decline" }),
    });
    router.refresh();
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {!isOwner && (
        <div style={{ marginBottom: 10 }}>
          <label
            style={{
              display: "block",
              fontSize: 12,
              color: "var(--muted)",
              marginBottom: 4,
            }}
          >
            Confirm the email this quote was sent to
            {buyerEmailHint ? ` (hint: ${maskEmail(buyerEmailHint)})` : ""}.
          </label>
          <input
            type="email"
            className="input"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
      )}
      <button
        className="btn btn-primary btn-block"
        onClick={accept}
        disabled={!!busy || (!isOwner && !email.trim())}
      >
        {busy === "accept" ? "Continuing to checkout…" : "Accept quote, continue to checkout"}
      </button>
      <button
        className="btn btn-ghost btn-block"
        style={{ marginTop: 9 }}
        onClick={decline}
        disabled={!!busy}
      >
        Decline
      </button>
    </div>
  );
}

function maskEmail(e: string): string {
  const at = e.indexOf("@");
  if (at < 2) return e;
  return e.slice(0, 2) + "***" + e.slice(at);
}

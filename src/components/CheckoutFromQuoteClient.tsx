"use client";

import { useState } from "react";

export default function CheckoutFromQuoteClient({
  quoteId,
  isOwner,
  buyerEmailHint,
  defaults,
}: {
  quoteId: string;
  isOwner: boolean;
  buyerEmailHint: string;
  defaults: { name: string; company: string };
}) {
  const [name, setName] = useState(defaults.name || "");
  const [company, setCompany] = useState(defaults.company || "");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/checkout-from-quote/${quoteId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: isOwner ? undefined : email.trim(),
        shipping: { name, company, line1, line2, city, region, postalCode },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Could not start checkout.");
      setBusy(false);
      return;
    }
    if (data.url) {
      window.location.href = data.url;
      return;
    }
    if (data.orderId) {
      window.location.href = `/orders/${data.orderId}`;
      return;
    }
    setBusy(false);
  }

  const canSubmit =
    !!name.trim() &&
    !!line1.trim() &&
    !!city.trim() &&
    !!region.trim() &&
    /^\d{5}/.test(postalCode.trim()) &&
    (isOwner || !!email.trim());

  return (
    <div className="card" style={{ marginTop: 22 }}>
      <div className="card-head">
        <h2>Ship to</h2>
      </div>
      <div className="card-body">
        {error && <div className="alert alert-error">{error}</div>}
        {!isOwner && (
          <div className="form-row">
            <label>
              Confirm the email this quote was sent to (hint:{" "}
              {maskEmail(buyerEmailHint)})
            </label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
        )}
        <div className="form-row">
          <label>Recipient name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label>Company</label>
          <input
            className="input"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label>Address line 1</label>
          <input
            className="input"
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label>Address line 2</label>
          <input
            className="input"
            value={line2}
            onChange={(e) => setLine2(e.target.value)}
          />
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>City</label>
            <input
              className="input"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label>State (2-letter)</label>
            <input
              className="input"
              value={region}
              maxLength={2}
              onChange={(e) => setRegion(e.target.value.toUpperCase())}
            />
          </div>
          <div className="form-row">
            <label>ZIP</label>
            <input
              className="input"
              value={postalCode}
              maxLength={10}
              onChange={(e) => setPostalCode(e.target.value)}
            />
          </div>
        </div>
        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 14 }}
          onClick={submit}
          disabled={!canSubmit || busy}
        >
          {busy ? "Computing freight, redirecting…" : "Continue to payment"}
        </button>
        <p
          className="muted-text"
          style={{ fontSize: 12, marginTop: 10, textAlign: "center" }}
        >
          You will be redirected to Stripe for tax computation and payment.
        </p>
      </div>
    </div>
  );
}

function maskEmail(e: string): string {
  const at = e.indexOf("@");
  if (at < 2) return e;
  return e.slice(0, 2) + "***" + e.slice(at);
}

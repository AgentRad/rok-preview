"use client";

import { useState } from "react";

type Rate = {
  carrier: string;
  service: string;
  cents: number;
  etaDays: number | null;
};

/**
 * Product-page freight widget. Buyer types their destination ZIP; we
 * call /api/freight/estimate which returns the top rates from Shippo
 * (or a "not configured" message that falls back gracefully).
 *
 * The product page only mounts this when the product has weight set AND
 * its supplier has a default warehouse, per the brief. Mount-time gating
 * happens in the server component; this stays a thin client component.
 */
export default function FreightEstimateWidget({
  sku,
  defaultQty = 1,
}: {
  sku: string;
  defaultQty?: number;
}) {
  const [zip, setZip] = useState("");
  const [qty, setQty] = useState(defaultQty);
  const [rates, setRates] = useState<Rate[]>([]);
  const [origin, setOrigin] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    setRates([]);
    setOrigin(null);
    try {
      const res = await fetch("/api/freight/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, destZip: zip, qty }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not get a freight estimate.");
        return;
      }
      if (data.message) setInfo(data.message);
      if (Array.isArray(data.rates) && data.rates.length > 0) {
        setRates(data.rates);
        if (data.originCity && data.originState) {
          setOrigin(`${data.originCity}, ${data.originState} ${data.originZip}`);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="freight-widget">
      <form onSubmit={submit} className="freight-widget-form">
        <label htmlFor={`freight-zip-${sku}`}>
          Estimate freight to your ZIP
        </label>
        <div className="freight-widget-row">
          <input
            id={`freight-zip-${sku}`}
            inputMode="numeric"
            pattern="[0-9]{5}"
            maxLength={10}
            placeholder="12345"
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/[^0-9-]/g, ""))}
            required
          />
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            style={{ width: 80 }}
            aria-label="Quantity for the estimate"
          />
          <button
            className="btn btn-dark btn-sm"
            type="submit"
            disabled={busy || zip.length < 5}
          >
            {busy ? "Quoting…" : "Get estimate"}
          </button>
        </div>
      </form>

      {error && (
        <div className="alert alert-error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      {info && rates.length === 0 && (
        <div className="muted-text" style={{ fontSize: 12.5, marginTop: 8 }}>
          {info}
        </div>
      )}
      {rates.length > 0 && (
        <div className="freight-widget-rates">
          {origin && (
            <div className="muted-text" style={{ fontSize: 12, marginBottom: 6 }}>
              Ships from {origin}
            </div>
          )}
          <ul>
            {rates.slice(0, 3).map((r, i) => (
              <li key={i}>
                <span className="freight-widget-rate-name">
                  {r.carrier} {r.service}
                </span>
                <span className="freight-widget-rate-price">
                  ${(r.cents / 100).toFixed(2)}
                  {r.etaDays != null ? ` · ${r.etaDays}d` : ""}
                </span>
              </li>
            ))}
          </ul>
          <div className="muted-text" style={{ fontSize: 11.5, marginTop: 4 }}>
            Estimate only. Final rate is locked at checkout.
          </div>
        </div>
      )}
    </div>
  );
}

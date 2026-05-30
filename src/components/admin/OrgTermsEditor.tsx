"use client";

import { useState } from "react";

const TERMS_OPTIONS = [
  { value: "PREPAID", label: "Prepaid (card at checkout)" },
  { value: "NET_15", label: "Net 15" },
  { value: "NET_30", label: "Net 30" },
  { value: "NET_60", label: "Net 60" },
];

export default function OrgTermsEditor({
  orgId,
  initialTerms,
  initialCreditLimitCents,
}: {
  orgId: string;
  initialTerms: string;
  initialCreditLimitCents: number | null;
}) {
  const [terms, setTerms] = useState(initialTerms);
  const [creditLimit, setCreditLimit] = useState(
    initialCreditLimitCents != null ? (initialCreditLimitCents / 100).toFixed(2) : ""
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/buyer-orgs/${orgId}/terms`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentTerms: terms, creditLimitDollars: creditLimit }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "Could not save terms.");
      } else {
        setMsg("Terms saved.");
      }
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" style={{ marginBottom: 24 }}>
      <h2 style={{ marginTop: 0 }}>Payment terms</h2>
      <p className="page-sub" style={{ marginTop: 0 }}>
        Prepaid orgs check out with a card as usual. Setting net terms lets this
        org place invoice orders billed with a due date. Credit limit is a manual
        ceiling for now.
      </p>
      <div className="row gap" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>Terms</span>
          <select value={terms} onChange={(e) => setTerms(e.target.value)}>
            {TERMS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>Credit limit (USD, optional)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="No limit"
            value={creditLimit}
            onChange={(e) => setCreditLimit(e.target.value)}
            disabled={terms === "PREPAID"}
          />
        </label>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save terms"}
        </button>
      </div>
      {msg && <p className="alert alert-success" style={{ marginTop: 12 }}>{msg}</p>}
      {err && <p className="alert alert-error" style={{ marginTop: 12 }}>{err}</p>}
    </section>
  );
}

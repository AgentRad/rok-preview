"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RefRow = { companyName?: string; contact?: string; phone?: string; email?: string };

type App = {
  id: string;
  reference: string;
  orgName: string | null;
  legalName: string;
  dba: string | null;
  ein: string;
  yearsInBusiness: number | null;
  expectedMonthlyCents: number;
  requestedLimitCents: number;
  requestedTerms: string;
  billingAddress: string;
  apContactName: string;
  apContactEmail: string;
  apContactPhone: string | null;
  references: unknown[];
  w9BlobUrl: string | null;
  dunsNumber: string | null;
  notes: string;
  createdAt: string;
};

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export default function CreditApplicationReview({ app }: { app: App }) {
  const router = useRouter();
  const [approvedTerms, setApprovedTerms] = useState(app.requestedTerms);
  const [approvedLimit, setApprovedLimit] = useState(dollars(app.requestedLimitCents));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function decide(action: "approve" | "reject") {
    setErr(null);
    if (action === "reject" && !note.trim()) {
      setErr("A reason is required to reject.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/credit-applications/${app.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          approvedTerms,
          approvedLimitDollars: approvedLimit,
          reviewerNote: note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "Could not record the decision.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const refs = app.references as RefRow[];

  return (
    <div className="card" style={{ padding: "1rem", border: "1px solid var(--hairline, #ddd)" }}>
      <div className="row between">
        <strong>{app.reference}</strong>
        <span className="muted">{app.createdAt.slice(0, 10)}</span>
      </div>
      <h3 style={{ margin: "0.25rem 0" }}>
        {app.orgName ?? app.legalName}
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1.5rem", fontSize: 13.5, marginTop: "0.5rem" }}>
        <div><span className="muted">Legal name:</span> {app.legalName}</div>
        {app.dba && <div><span className="muted">DBA:</span> {app.dba}</div>}
        <div><span className="muted">EIN:</span> {app.ein}</div>
        {app.yearsInBusiness != null && <div><span className="muted">Years in business:</span> {app.yearsInBusiness}</div>}
        <div><span className="muted">Requested:</span> {app.requestedTerms.replace("NET_", "Net ")}, ${dollars(app.requestedLimitCents)}</div>
        <div><span className="muted">Expected monthly:</span> ${dollars(app.expectedMonthlyCents)}</div>
        <div><span className="muted">AP contact:</span> {app.apContactName} ({app.apContactEmail}){app.apContactPhone ? `, ${app.apContactPhone}` : ""}</div>
        {app.dunsNumber && <div><span className="muted">D-U-N-S:</span> {app.dunsNumber}</div>}
      </div>

      <div style={{ fontSize: 13.5, marginTop: "0.5rem" }}>
        <span className="muted">Billing address:</span> {app.billingAddress}
      </div>
      {app.w9BlobUrl && (
        <div style={{ fontSize: 13.5, marginTop: "0.25rem" }}>
          <a href={app.w9BlobUrl} target="_blank" rel="noreferrer">View W-9</a>
        </div>
      )}
      {app.notes && (
        <div style={{ fontSize: 13.5, marginTop: "0.25rem" }}>
          <span className="muted">Notes:</span> {app.notes}
        </div>
      )}

      {refs.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <span className="muted" style={{ fontSize: 13 }}>Trade references:</span>
          <ul style={{ margin: "0.25rem 0", paddingLeft: 20, fontSize: 13 }}>
            {refs.map((r, i) => (
              <li key={i}>
                {r.companyName}
                {r.contact ? ` - ${r.contact}` : ""}
                {r.phone ? `, ${r.phone}` : ""}
                {r.email ? `, ${r.email}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {err && <div className="alert alert-error" style={{ marginTop: "0.75rem" }}>{err}</div>}

      <div className="row gap" style={{ marginTop: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field" style={{ minWidth: 130 }}>
          <label>Approved terms</label>
          <select value={approvedTerms} onChange={(e) => setApprovedTerms(e.target.value)}>
            <option value="NET_15">Net 15</option>
            <option value="NET_30">Net 30</option>
            <option value="NET_60">Net 60</option>
          </select>
        </div>
        <div className="field" style={{ minWidth: 150 }}>
          <label>Approved limit (USD)</label>
          <input value={approvedLimit} onChange={(e) => setApprovedLimit(e.target.value)} inputMode="decimal" />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label>Decision note (required to reject)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div className="row gap" style={{ marginTop: "0.5rem" }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide("approve")}>
          {busy ? "Working..." : "Approve"}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => decide("reject")}>
          Reject
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Row = {
  rowNumber: number;
  sku: string;
  name: string;
  price: number;
  stock: number;
  error: string | null;
  exists: boolean;
};

type Preview = {
  counts: {
    total: number;
    valid?: number;
    invalid: number;
    created: number;
    updated: number;
  };
  rows: Row[];
};

type CleanupRow = {
  sku: string;
  name: string;
  confidence: "high" | "medium" | "low";
  notes: string;
};

const SAMPLE = `sku,name,category,manufacturer,price,unit,etaDays,stock,quoteOnly,description
EX-001,Sample 100A breaker,Switchgear & Breakers,Eaton,420,each,5,12,false,Sample product line.
`;

export default function CatalogCsvImport() {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Preview | null>(null);

  const [messy, setMessy] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiFlags, setAiFlags] = useState<CleanupRow[] | null>(null);

  async function cleanupWithAI() {
    if (!messy.trim()) return;
    setAiBusy(true);
    setAiError("");
    setAiFlags(null);
    try {
      const res = await fetch("/api/supplier/catalog-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: messy }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiError(data.error || "AI cleanup failed.");
        return;
      }
      setCsv(data.csv || "");
      setPreview(null);
      setAiFlags(
        ((data.rows || []) as CleanupRow[]).filter(
          (r) => r.confidence === "low" || (r.notes && r.notes.trim())
        )
      );
    } finally {
      setAiBusy(false);
    }
  }

  async function send(commit: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/supplier/catalog-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, commit }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not process the CSV.");
        return;
      }
      if (commit) {
        setDone(data);
        setPreview(null);
        setCsv("");
        router.refresh();
      } else {
        setPreview(data);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {done && (
        <div className="alert alert-ok" style={{ marginBottom: 14 }}>
          Imported {done.counts.created} new and {done.counts.updated} updated.
          {done.counts.invalid > 0 && ` ${done.counts.invalid} rows had errors and were skipped.`}
        </div>
      )}

      <div className="ai-cleanup-block">
        <div className="invoice-meta-label" style={{ marginBottom: 6 }}>
          Smart import (AI)
        </div>
        <p className="muted-text" style={{ fontSize: 13, marginBottom: 8 }}>
          Paste anything: a messy price sheet, an Excel copy-paste, an email
          body, a CSV with the wrong headers. The AI converts it into the
          PartsPort catalog format below. Nothing goes live until you preview
          and import.
        </p>
        <textarea
          value={messy}
          onChange={(e) => setMessy(e.target.value)}
          placeholder="Paste any catalog text or table here..."
          spellCheck={false}
          style={{
            width: "100%",
            minHeight: 130,
            fontFamily: "var(--mono)",
            fontSize: 12.5,
            padding: 12,
            border: "1px solid var(--line-strong)",
            borderRadius: "var(--radius-sm)",
            background: "var(--surface)",
          }}
        />
        <div className="row-gap" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-dark btn-sm"
            onClick={cleanupWithAI}
            disabled={aiBusy || !messy.trim()}
          >
            {aiBusy ? "Cleaning up…" : "Clean up with AI"}
          </button>
          <span className="muted-text" style={{ fontSize: 12 }}>
            The cleaned CSV lands in the box below for you to review.
          </span>
        </div>
        {aiError && (
          <div className="alert alert-error" style={{ marginTop: 8 }}>
            {aiError}
          </div>
        )}
        {aiFlags && aiFlags.length > 0 && (
          <div className="alert alert-info" style={{ marginTop: 8 }}>
            <strong>{aiFlags.length} row{aiFlags.length === 1 ? "" : "s"}</strong>{" "}
            need a human look before import:
            <ul style={{ margin: "8px 0 0 18px", fontSize: 13 }}>
              {aiFlags.slice(0, 8).map((r, i) => (
                <li key={r.sku || i}>
                  <strong>{r.sku || "(no SKU)"}</strong>
                  {r.name ? ` ${r.name}` : ""}
                  {r.notes ? `: ${r.notes}` : ""}
                  {r.confidence === "low" ? " (low confidence)" : ""}
                </li>
              ))}
              {aiFlags.length > 8 && (
                <li>…and {aiFlags.length - 8} more</li>
              )}
            </ul>
          </div>
        )}
      </div>

      <div style={{ height: 1, background: "var(--line)", margin: "20px 0" }} />

      <p className="muted-text" style={{ fontSize: 13.5, marginBottom: 10 }}>
        Or paste CSV directly. Required columns:{" "}
        <code style={{ fontFamily: "var(--mono)" }}>
          sku, name, category, manufacturer, price
        </code>
        . Optional: <code style={{ fontFamily: "var(--mono)" }}>unit, etaDays, stock, quoteOnly, description, imageUrl</code>.
      </p>
      <textarea
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setPreview(null);
        }}
        placeholder={SAMPLE}
        spellCheck={false}
        style={{
          width: "100%",
          minHeight: 180,
          fontFamily: "var(--mono)",
          fontSize: 12.5,
          padding: 12,
          border: "1px solid var(--line-strong)",
          borderRadius: "var(--radius-sm)",
          background: "var(--surface)",
        }}
      />
      <div className="row-gap" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => send(false)}
          disabled={busy || !csv.trim()}
        >
          {busy ? "…" : "Preview"}
        </button>
        {preview && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => send(true)}
            disabled={busy || (preview.counts.valid ?? 0) === 0}
          >
            Import {preview.counts.created} new and {preview.counts.updated} updated
          </button>
        )}
      </div>

      {preview && (
        <div style={{ marginTop: 16 }}>
          <div className="muted-text" style={{ fontSize: 13, marginBottom: 6 }}>
            {preview.counts.total} rows · {preview.counts.valid} ready · {preview.counts.invalid} with errors
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>SKU</th>
                  <th>Name</th>
                  <th className="num">Price</th>
                  <th className="num">Stock</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr
                    key={r.rowNumber}
                    style={r.error ? { background: "rgba(176, 74, 44, 0.06)" } : undefined}
                  >
                    <td>{r.rowNumber}</td>
                    <td style={{ fontWeight: 700 }}>{r.sku || "-"}</td>
                    <td>{r.name || "-"}</td>
                    <td className="num">${Number(r.price || 0).toFixed(2)}</td>
                    <td className="num">{r.stock}</td>
                    <td>
                      {r.error ? (
                        <span style={{ color: "var(--red)" }}>{r.error}</span>
                      ) : r.exists ? (
                        <span className="badge badge-paid">Update</span>
                      ) : (
                        <span className="badge badge-approved">Create</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

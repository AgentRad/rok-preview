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

const SAMPLE = `sku,name,category,manufacturer,icon,price,unit,etaDays,stock,description
EX-001,Sample 100A breaker,Switchgear & Breakers,Eaton,breaker,420,each,5,12,Sample product line.
`;

export default function CatalogCsvImport() {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Preview | null>(null);

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

      <p className="muted-text" style={{ fontSize: 13.5, marginBottom: 10 }}>
        Paste CSV with a header row. Required columns:{" "}
        <code style={{ fontFamily: "var(--mono)" }}>
          sku, name, category, manufacturer, price
        </code>
        . Optional: <code style={{ fontFamily: "var(--mono)" }}>icon, unit, etaDays, stock, description, imageUrl</code>.
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
                    <td style={{ fontWeight: 700 }}>{r.sku || "—"}</td>
                    <td>{r.name || "—"}</td>
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

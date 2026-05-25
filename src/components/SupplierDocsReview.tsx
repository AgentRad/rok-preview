"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type SupplierDocReviewRow = {
  id: string;
  supplierId: string;
  supplierName: string;
  kind: string;
  filename: string;
  url: string;
  status: string;
  reviewNote: string;
  uploadedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

const KIND_LABEL: Record<string, string> = {
  SUPPLIER_AGREEMENT: "Supplier Agreement",
  W9: "W9",
  INSURANCE_COI: "Certificate of Insurance",
  OTHER: "Other",
};

const STATUS_BADGE: Record<string, string> = {
  PENDING: "badge-pending",
  APPROVED: "badge-fulfilled",
  REJECTED: "badge-cancelled",
};

export default function SupplierDocsReview({
  rows,
}: {
  rows: SupplierDocReviewRow[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.id, r.reviewNote]))
  );
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  async function setStatus(id: string, status: "APPROVED" | "REJECTED") {
    setBusyId(id);
    setErrorById((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/admin/supplier-documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reviewNote: noteById[id] || "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorById((prev) => ({
          ...prev,
          [id]: data.error || "Update failed.",
        }));
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="empty-block">
        <h3>No supplier documents uploaded yet</h3>
        <p>
          Documents uploaded by suppliers from /supplier appear here for
          review.
        </p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Supplier</th>
            <th>Document</th>
            <th>Uploaded</th>
            <th>Status</th>
            <th>Review note</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <div style={{ fontWeight: 600 }}>{r.supplierName}</div>
              </td>
              <td>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {KIND_LABEL[r.kind] || r.kind}
                </div>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 12,
                    color: "var(--blue)",
                    textDecoration: "none",
                    fontWeight: 600,
                  }}
                >
                  View {r.filename || "document"} &rarr;
                </a>
              </td>
              <td style={{ fontSize: 12.5 }}>
                {new Date(r.uploadedAt).toLocaleDateString()}
                {r.reviewedAt && (
                  <div className="muted-text" style={{ fontSize: 11.5 }}>
                    Reviewed {new Date(r.reviewedAt).toLocaleDateString()}
                    {r.reviewedBy ? ` · ${r.reviewedBy}` : ""}
                  </div>
                )}
              </td>
              <td>
                <span
                  className={"badge " + (STATUS_BADGE[r.status] || "badge-pending")}
                >
                  {r.status}
                </span>
              </td>
              <td>
                <div className="admin-doc-actions">
                  <textarea
                    placeholder="Optional note shown to supplier (e.g. 'COI expired, please re-upload')"
                    value={noteById[r.id] || ""}
                    onChange={(e) =>
                      setNoteById((prev) => ({
                        ...prev,
                        [r.id]: e.target.value,
                      }))
                    }
                    rows={2}
                  />
                  {errorById[r.id] && (
                    <span className="alert alert-error" style={{ fontSize: 12 }}>
                      {errorById[r.id]}
                    </span>
                  )}
                </div>
              </td>
              <td className="num">
                {r.status !== "APPROVED" && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setStatus(r.id, "APPROVED")}
                    disabled={busyId === r.id}
                    style={{ marginRight: 6 }}
                  >
                    {busyId === r.id ? "…" : "Approve"}
                  </button>
                )}
                {r.status !== "REJECTED" && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setStatus(r.id, "REJECTED")}
                    disabled={busyId === r.id}
                  >
                    Reject
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

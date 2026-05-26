"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ExemptRow = {
  id: string;
  certificateUrl: string;
  status: string; // PENDING / APPROVED / REJECTED
  label: string;
  recipient: string;
  company: string;
  city: string;
  region: string;
  postalCode: string;
  buyerName: string;
  buyerEmail: string;
  createdAt: string;
};

const BADGE_CLASS: Record<string, string> = {
  PENDING: "badge-pending",
  APPROVED: "badge-fulfilled",
  REJECTED: "badge-cancelled",
};

export default function TaxExemptReview({ rows }: { rows: ExemptRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function setStatus(id: string, status: "APPROVED" | "REJECTED") {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/addresses/${id}/tax-exempt`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Update failed.");
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
        <h3>No tax-exempt certificates on file</h3>
        <p>Buyers upload certs from /account; they appear here for review.</p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="alert alert-error" style={{ margin: 16 }}>
          {error}
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Buyer</th>
              <th>Ship-to</th>
              <th>Cert</th>
              <th>Uploaded</th>
              <th>Status</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.buyerName}</div>
                  <div className="muted-text" style={{ fontSize: 12 }}>
                    {r.buyerEmail}
                  </div>
                  {r.company && (
                    <div className="muted-text" style={{ fontSize: 12 }}>
                      {r.company}
                    </div>
                  )}
                </td>
                <td>
                  <div style={{ fontSize: 13 }}>
                    {r.recipient}
                    {r.label ? ` (${r.label})` : ""}
                  </div>
                  <div className="muted-text" style={{ fontSize: 12 }}>
                    {r.city}, {r.region} {r.postalCode}
                  </div>
                </td>
                <td>
                  <a
                    href={r.certificateUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
                  >
                    View cert &rarr;
                  </a>
                </td>
                <td style={{ fontSize: 13 }}>
                  {new Date(r.createdAt).toLocaleDateString()}
                </td>
                <td>
                  <span
                    className={"badge " + (BADGE_CLASS[r.status] || "badge-pending")}
                  >
                    {r.status}
                  </span>
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
    </>
  );
}

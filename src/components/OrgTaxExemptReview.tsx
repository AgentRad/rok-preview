"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type OrgExemptRow = {
  id: string;
  name: string;
  certificateUrl: string;
  status: string;
  expiresAt: string | null;
};

const BADGE_CLASS: Record<string, string> = {
  PENDING: "badge-pending",
  APPROVED: "badge-fulfilled",
  REJECTED: "badge-cancelled",
};

export default function OrgTaxExemptReview({ rows }: { rows: OrgExemptRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function setStatus(id: string, status: "APPROVED" | "REJECTED") {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/buyer-orgs/${id}/tax-exempt`, {
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
        <h3>No org certificates on file</h3>
        <p>Org admins submit certs from /buyer-org; they appear here for review.</p>
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
              <th>Organization</th>
              <th>Cert</th>
              <th>Expires</th>
              <th>Status</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>{r.name}</td>
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
                  {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "No expiry"}
                </td>
                <td>
                  <span className={"badge " + (BADGE_CLASS[r.status] || "badge-pending")}>
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

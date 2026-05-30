"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * PLH-3c F3: admin row for reviewing a single MANUFACTURER application.
 * Approve writes User.manufacturerName + flips APPROVED. Reject collects
 * a reason. Both surfaces audit-log + email the OEM.
 */
export default function ManufacturerApplicationRow({
  id,
  manufacturerName,
  userName,
  userEmail,
  submittedAt,
}: {
  id: string;
  manufacturerName: string;
  userName: string;
  userEmail: string;
  submittedAt: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  async function send(decision: "APPROVED" | "REJECTED") {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/manufacturer-applications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reason }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not save.");
      return;
    }
    router.refresh();
  }

  return (
    <tr>
      <td>
        <strong>{manufacturerName}</strong>
      </td>
      <td>
        {userName} <span className="muted">({userEmail})</span>
      </td>
      <td>{new Date(submittedAt).toLocaleString()}</td>
      <td>
        {error && <div className="alert alert-error">{error}</div>}
        {showReject ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (shown to OEM)"
              maxLength={300}
              style={{ flex: 1, minWidth: 220 }}
            />
            <button
              className="btn btn-sm btn-danger"
              disabled={busy || !reason.trim()}
              onClick={() => send("REJECTED")}
            >
              {busy ? "Saving…" : "Confirm reject"}
            </button>
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => {
                setShowReject(false);
                setReason("");
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={() => send("APPROVED")}
            >
              {busy ? "Saving…" : "Approve"}
            </button>
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => setShowReject(true)}
            >
              Reject
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

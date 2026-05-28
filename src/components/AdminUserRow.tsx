"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * PLH-3w P1: admin row for one user. Suspend opens a reason modal (500
 * char cap). Ban is gated behind a separate confirm dialog because it is
 * terminal (blacklists the email). Unsuspend is a single click.
 */
export default function AdminUserRow({
  id,
  name,
  email,
  role,
  status,
  suspendedReason,
  createdAt,
}: {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  suspendedReason: string | null;
  createdAt: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"none" | "suspend" | "ban">("none");
  const [reason, setReason] = useState("");

  const [recoveryNote, setRecoveryNote] = useState("");

  async function send(action: "suspend" | "unsuspend" | "ban" | "2fa-recovery") {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not save.");
      return;
    }
    if (action === "2fa-recovery") {
      setRecoveryNote("2FA recovery granted for 1 hour.");
    }
    setMode("none");
    setReason("");
    router.refresh();
  }

  const badgeClass =
    status === "ACTIVE"
      ? "badge badge-paid"
      : status === "SUSPENDED"
      ? "badge badge-pending"
      : "badge badge-cancelled";

  return (
    <tr>
      <td>
        <strong>{name}</strong>
        <br />
        <span className="muted">{email}</span>
      </td>
      <td>{role}</td>
      <td>
        <span className={badgeClass}>{status}</span>
        {status === "SUSPENDED" && suspendedReason && (
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {suspendedReason}
          </div>
        )}
      </td>
      <td>{new Date(createdAt).toLocaleDateString()}</td>
      <td>
        {error && <div className="alert alert-error">{error}</div>}
        {status === "BANNED" ? (
          <span className="muted">Banned</span>
        ) : mode === "suspend" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for suspension (required)"
              maxLength={500}
              rows={2}
              style={{ minWidth: 240 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-sm btn-danger"
                disabled={busy || !reason.trim()}
                onClick={() => send("suspend")}
              >
                {busy ? "Saving…" : "Confirm suspend"}
              </button>
              <button
                className="btn btn-sm btn-ghost"
                disabled={busy}
                onClick={() => {
                  setMode("none");
                  setReason("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : mode === "ban" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="alert alert-error" style={{ marginBottom: 0 }}>
              Banning is permanent. The account is locked and this email can
              never register again.
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for ban (required)"
              maxLength={500}
              rows={2}
              style={{ minWidth: 240 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-sm btn-danger"
                disabled={busy || !reason.trim()}
                onClick={() => send("ban")}
              >
                {busy ? "Banning…" : "Confirm ban"}
              </button>
              <button
                className="btn btn-sm btn-ghost"
                disabled={busy}
                onClick={() => {
                  setMode("none");
                  setReason("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {status === "SUSPENDED" ? (
              <button
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => send("unsuspend")}
              >
                {busy ? "Saving…" : "Unsuspend"}
              </button>
            ) : (
              <button
                className="btn btn-sm btn-ghost"
                disabled={busy}
                onClick={() => setMode("suspend")}
              >
                Suspend
              </button>
            )}
            <button
              className="btn btn-sm btn-danger"
              disabled={busy}
              onClick={() => setMode("ban")}
            >
              Ban
            </button>
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy}
              title="Grant a 1-hour window for the user to re-enroll 2FA"
              onClick={() => send("2fa-recovery")}
            >
              2FA recovery
            </button>
          </div>
        )}
        {recoveryNote && (
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {recoveryNote}
          </div>
        )}
      </td>
    </tr>
  );
}

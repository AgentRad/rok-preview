"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * PLH-3w P3: one row in the admin reported-messages queue. Dismiss marks
 * the report reviewed. Suspend sender links to the P1 /admin/users flow
 * pre-filtered to the sender's email so the admin uses the reason modal
 * there.
 */
export default function ReportedMessageRow({
  id,
  body,
  senderName,
  senderEmail,
  senderRole,
  reporterLabel,
  reason,
  reportedAt,
  contextLabel,
  contextHref,
}: {
  id: string;
  body: string;
  senderName: string;
  senderEmail: string;
  senderRole: string;
  reporterLabel: string;
  reason: string;
  reportedAt: string;
  contextLabel: string;
  contextHref: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function dismiss() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/reported-messages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss" }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not dismiss.");
      return;
    }
    router.refresh();
  }

  return (
    <tr>
      <td style={{ maxWidth: 360 }}>
        <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{body}</div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
          {contextHref ? (
            <Link href={contextHref}>{contextLabel}</Link>
          ) : (
            contextLabel
          )}
          {reportedAt && ` · reported ${new Date(reportedAt).toLocaleString()}`}
        </div>
      </td>
      <td>
        {senderName}
        <br />
        <span className="muted">{senderEmail}</span>
        <br />
        <span className="muted" style={{ fontSize: 11.5 }}>
          {senderRole.toLowerCase()}
        </span>
      </td>
      <td>{reporterLabel}</td>
      <td>{reason}</td>
      <td>
        {error && <div className="alert alert-error">{error}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={dismiss}
          >
            {busy ? "Saving…" : "Dismiss"}
          </button>
          <Link
            href={`/admin/users?q=${encodeURIComponent(senderEmail)}`}
            className="btn btn-sm btn-danger"
          >
            Suspend sender
          </Link>
        </div>
      </td>
    </tr>
  );
}

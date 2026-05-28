"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ThreadVisibility =
  | "PUBLIC"
  | "SUPPLIER_INTERNAL"
  | "BUYER_INTERNAL"
  | "ADMIN_ONLY";

export type ThreadViewerRole = "admin" | "buyer" | "supplier" | "none";

export type ThreadMessage = {
  id: string;
  senderName: string;
  senderRole: string;
  body: string;
  createdAt: string;
  visibility: ThreadVisibility;
};

type Props = {
  messages: ThreadMessage[];
  orderId?: string;
  quoteId?: string;
  canPost: boolean;
  viewerRole?: ThreadViewerRole;
};

function visibilityStyle(v: ThreadVisibility): React.CSSProperties {
  if (v === "SUPPLIER_INTERNAL") {
    return {
      borderLeft: "3px solid var(--amber-deep, #b45309)",
      paddingLeft: 10,
    };
  }
  if (v === "ADMIN_ONLY") {
    return {
      borderLeft: "3px solid #6b7280",
      paddingLeft: 10,
    };
  }
  if (v === "BUYER_INTERNAL") {
    return {
      borderLeft: "3px solid #6b7280",
      paddingLeft: 10,
    };
  }
  return {};
}

function visibilityLabel(v: ThreadVisibility): string | null {
  if (v === "SUPPLIER_INTERNAL") return "Internal, team only";
  if (v === "ADMIN_ONLY") return "Admin only";
  if (v === "BUYER_INTERNAL") return "Internal, buyer only";
  return null;
}

export default function MessageThread({
  messages,
  orderId,
  quoteId,
  canPost,
  viewerRole = "none",
}: Props) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visibility, setVisibility] = useState<ThreadVisibility>("PUBLIC");

  const showSupplierToggle = viewerRole === "supplier" || viewerRole === "admin";
  const showAdminOption = viewerRole === "admin";

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, quoteId, body, visibility }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not send the message.");
        return;
      }
      setBody("");
      setVisibility("PUBLIC");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="thread">
      {messages.length === 0 ? (
        <p className="muted-text" style={{ fontSize: 13.5, marginBottom: 14 }}>
          No messages yet. Posts here also reach the other party by email so
          nothing gets lost.
        </p>
      ) : (
        <ul className="thread-list">
          {messages.map((m) => {
            const label = visibilityLabel(m.visibility);
            return (
              <li key={m.id} className="thread-message" style={visibilityStyle(m.visibility)}>
                <div className="thread-meta">
                  <strong style={{ fontSize: 13.5 }}>{m.senderName}</strong>
                  <span
                    className="muted-text"
                    style={{ fontSize: 11.5 }}
                    suppressHydrationWarning
                  >
                    {m.senderRole.toLowerCase()} ·{" "}
                    {new Date(m.createdAt).toLocaleString()}
                  </span>
                  {label && (
                    <span
                      className="muted-text"
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        color:
                          m.visibility === "SUPPLIER_INTERNAL"
                            ? "var(--amber-deep, #b45309)"
                            : "#6b7280",
                      }}
                    >
                      {label}
                    </span>
                  )}
                </div>
                <div className="thread-body">{m.body}</div>
              </li>
            );
          })}
        </ul>
      )}

      {canPost ? (
        <form onSubmit={send} className="thread-form">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a message"
            maxLength={4000}
            rows={4}
          />
          {(showSupplierToggle || showAdminOption) && (
            <div
              className="row-gap"
              style={{ marginTop: 8, fontSize: 13, alignItems: "center" }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="muted-text">Visible to</span>
                <select
                  value={visibility}
                  onChange={(e) =>
                    setVisibility(e.target.value as ThreadVisibility)
                  }
                  disabled={busy}
                >
                  <option value="PUBLIC">Everyone</option>
                  {showSupplierToggle && (
                    <option value="SUPPLIER_INTERNAL">My team only</option>
                  )}
                  {showAdminOption && (
                    <option value="ADMIN_ONLY">Admins only</option>
                  )}
                </select>
              </label>
            </div>
          )}
          {error && <div className="alert alert-error">{error}</div>}
          <div className="row-gap" style={{ marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>
              {busy ? "Sending…" : "Send message"}
            </button>
          </div>
        </form>
      ) : (
        <p className="muted-text" style={{ fontSize: 13 }}>
          Sign in as the buyer, the supplier, or an admin to post in this
          thread.
        </p>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ThreadMessage = {
  id: string;
  senderName: string;
  senderRole: string;
  body: string;
  createdAt: string;
};

type Props = {
  messages: ThreadMessage[];
  orderId?: string;
  quoteId?: string;
  canPost: boolean;
};

export default function MessageThread({
  messages,
  orderId,
  quoteId,
  canPost,
}: Props) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, quoteId, body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not send the message.");
        return;
      }
      setBody("");
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
          {messages.map((m) => (
            <li key={m.id} className="thread-message">
              <div className="thread-meta">
                <strong style={{ fontSize: 13.5 }}>{m.senderName}</strong>
                <span className="muted-text" style={{ fontSize: 11.5 }}>
                  {m.senderRole.toLowerCase()} ·{" "}
                  {new Date(m.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="thread-body">{m.body}</div>
            </li>
          ))}
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

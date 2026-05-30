"use client";

import { useState } from "react";

/**
 * PLH-3s B2: dashboard tile that fires /api/ai/summarize-rfqs and renders
 * the streamed Markdown in a slide-in side panel.
 */
export default function SummarizeRfqsTile({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setOpen(true);
    setText("");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/summarize-rfqs", { method: "POST" });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setError(
          typeof j.error === "string" ? j.error : "Could not summarize RFQs."
        );
        setBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setText((t) => t + decoder.decode(value, { stream: true }));
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <h2>RFQ summary</h2>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => void start()}
          disabled={busy}
        >
          {busy ? "Working..." : "Summarize my open RFQs"}
        </button>
      </div>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: "min(440px, 100%)",
            background: "var(--bg, #fff)",
            borderLeft: "1px solid var(--line)",
            zIndex: 100,
            display: "flex",
            flexDirection: "column",
            padding: 18,
            gap: 12,
            boxShadow: "-8px 0 24px rgba(0,0,0,0.12)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16 }}>Open RFQs summary</h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: 14,
              fontSize: 13.5,
              lineHeight: 1.55,
              background: "var(--bg-soft, #fafaf7)",
              whiteSpace: "pre-wrap",
              overflowY: "auto",
              flex: 1,
            }}
          >
            {text || (
              <span className="muted-text">
                {busy ? "Drafting summary..." : "No content yet."}
              </span>
            )}
          </div>
          {error && (
            <div className="alert alert-error" style={{ fontSize: 13 }}>
              {error}
            </div>
          )}
          <p className="muted-text" style={{ fontSize: 11.5, margin: 0 }}>
            AI-generated. Verify before acting.
          </p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";

/**
 * PLH-3s B1: "Draft invoice with AI" button + modal on the order page.
 * Streams a Markdown invoice from /api/ai/draft-invoice and offers a
 * copy-to-clipboard action. No PDF export this round (no PDF lib in deps).
 */
export default function DraftInvoiceWithAI({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function start() {
    setOpen(true);
    setText("");
    setError(null);
    setBusy(true);
    setCopied(false);
    try {
      const res = await fetch("/api/ai/draft-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setError(
          typeof j.error === "string"
            ? j.error
            : "Could not draft invoice."
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

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copy failed. Select the text and copy manually.");
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => void start()}
        disabled={busy && !open}
      >
        Draft invoice with AI
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={() => {
            if (!busy) setOpen(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg, #fff)",
              maxWidth: 760,
              width: "100%",
              maxHeight: "90vh",
              borderRadius: 8,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              border: "1px solid var(--line)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18 }}>AI invoice draft</h2>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Close
              </button>
            </div>
            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: 14,
                fontFamily: "var(--mono)",
                fontSize: 13,
                lineHeight: 1.55,
                background: "var(--bg-soft, #fafaf7)",
                whiteSpace: "pre-wrap",
                overflowY: "auto",
                flex: 1,
                minHeight: 200,
              }}
            >
              {text || (
                <span className="muted-text">
                  {busy ? "Drafting..." : "No content yet."}
                </span>
              )}
            </div>
            {error && (
              <div className="alert alert-error" style={{ fontSize: 13 }}>
                {error}
              </div>
            )}
            <div className="row-gap" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void copy()}
                disabled={busy || text.length === 0}
              >
                {copied ? "Copied" : "Copy to clipboard"}
              </button>
            </div>
            <p className="muted-text" style={{ fontSize: 11.5, margin: 0 }}>
              AI-generated draft. Review before sending. Numbers reflect the
              current order data.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

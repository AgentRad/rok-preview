"use client";

import { useState } from "react";

/**
 * PLH-3s B3: inline "Draft reply with AI" panel on the RFQ thread page.
 * Streams the draft from /api/ai/draft-rfq-reply and offers a
 * "Copy to composer" button that drops the text into the MessageThread
 * textarea (no auto-send) via a window CustomEvent.
 */
export default function DraftRfqReply({ quoteId }: { quoteId: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function start() {
    setText("");
    setError(null);
    setCopied(false);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/draft-rfq-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteId }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setError(
          typeof j.error === "string" ? j.error : "Could not draft reply."
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

  function copyToComposer() {
    window.dispatchEvent(
      new CustomEvent("partsport:set-thread-draft", { detail: { text } })
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      style={{
        border: "1px dashed var(--line)",
        borderRadius: 6,
        padding: 12,
        marginBottom: 14,
        background: "var(--bg-soft, #fafaf7)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600 }}>AI draft reply</div>
        <div className="row-gap" style={{ gap: 6 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void start()}
            disabled={busy}
          >
            {busy
              ? "Drafting..."
              : text
                ? "Regenerate"
                : "Draft reply with AI"}
          </button>
          {text && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={copyToComposer}
              disabled={busy || !text.trim()}
            >
              {copied ? "Copied" : "Copy to composer"}
            </button>
          )}
        </div>
      </div>
      {(text || busy || error) && (
        <div
          style={{
            marginTop: 10,
            padding: 12,
            border: "1px solid var(--line)",
            borderRadius: 6,
            background: "var(--bg, #fff)",
            fontSize: 13.5,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            minHeight: 60,
          }}
        >
          {text || (
            <span className="muted-text">
              {busy ? "Drafting..." : ""}
            </span>
          )}
        </div>
      )}
      {error && (
        <div
          className="alert alert-error"
          style={{ fontSize: 13, marginTop: 10 }}
        >
          {error}
        </div>
      )}
      <p className="muted-text" style={{ fontSize: 11.5, margin: "8px 0 0" }}>
        AI-generated. Review before sending. The draft never commits to a
        price.
      </p>
    </div>
  );
}

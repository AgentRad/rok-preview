"use client";

import { useEffect, useRef, useState } from "react";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

/**
 * PLH-2 Phase 2: collapsible chat panel on the supplier dashboard.
 * History lives in component state only, dropped on reload (v1 scope).
 */
export default function SupplierAIAssistant({
  enabled,
}: {
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    if (q.length > 2000) {
      setError("Question is too long, keep it under 2000 characters.");
      return;
    }
    setError(null);
    setInput("");

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      text: q,
    };
    const assistantId = `a-${Date.now()}`;
    setMessages((m) => [
      ...m,
      userMsg,
      { id: assistantId, role: "assistant", text: "" },
    ]);
    setBusy(true);

    try {
      const res = await fetch("/api/supplier/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setError(
          typeof j.error === "string" ? j.error : "The assistant could not respond."
        );
        setMessages((m) => m.filter((x) => x.id !== assistantId));
        setBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((m) =>
          m.map((x) =>
            x.id === assistantId ? { ...x, text: x.text + chunk } : x
          )
        );
      }
    } catch {
      setError("Network error. Try again.");
      setMessages((m) => m.filter((x) => x.id !== assistantId));
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <div className="card" id="ai-assistant">
        <div className="card-head">
          <h2>AI assistant</h2>
          <span className="muted-text" style={{ fontSize: 12 }}>
            Unavailable
          </span>
        </div>
        <div className="card-body">
          <p className="muted-text" style={{ fontSize: 13 }}>
            The AI assistant is not configured on this deployment. Ask an admin
            to set the ANTHROPIC_API_KEY environment variable to turn it on.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card" id="ai-assistant">
      <div className="card-head">
        <h2>AI assistant</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="ai-assistant-panel"
        >
          {open ? "Hide" : "Open"}
        </button>
      </div>
      {open && (
        <div className="card-body" id="ai-assistant-panel">
          <p className="muted-text" style={{ fontSize: 13, marginTop: 0 }}>
            Ask about your sales, inventory, payouts, refunds, or balance.
            Examples: &quot;What is my refund rate this month?&quot;,
            &quot;Which SKUs sold the most this quarter?&quot;, &quot;Why was
            my last payout reduced?&quot;, &quot;How much do I owe the platform
            right now?&quot;.
          </p>

          <div
            ref={scrollRef}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: 12,
              minHeight: 180,
              maxHeight: 360,
              overflowY: "auto",
              background: "var(--bg-soft, #fafaf7)",
              marginBottom: 12,
              fontSize: 13.5,
              lineHeight: 1.5,
            }}
          >
            {messages.length === 0 ? (
              <p className="muted-text" style={{ fontSize: 12.5, margin: 0 }}>
                Your conversation will appear here. History resets when you
                refresh the page.
              </p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    marginBottom: 12,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                      color: "var(--muted)",
                      marginBottom: 3,
                    }}
                  >
                    {m.role === "user" ? "You" : "Assistant"}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>
                    {m.text || (
                      <span className="muted-text">Thinking...</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {error && (
            <div
              className="alert alert-error"
              style={{ marginBottom: 12, fontSize: 13 }}
            >
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <textarea
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Ask a question about your business..."
              rows={3}
              maxLength={2000}
              disabled={busy}
              style={{ flex: 1, resize: "vertical", fontSize: 13.5 }}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void send()}
              disabled={busy || input.trim().length === 0}
              style={{ alignSelf: "flex-end" }}
            >
              {busy ? "Sending..." : "Send"}
            </button>
          </div>
          <div
            className="muted-text"
            style={{ fontSize: 11, marginTop: 6, textAlign: "right" }}
          >
            {input.length} / 2000 · Cmd or Ctrl + Enter to send
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import { useState } from "react";

export default function ApprovalBypassButton({ orderId }: { orderId: string }) {
  const [state, setState] = useState<"idle" | "confirming" | "sending" | "done" | "error">("idle");
  const [reason, setReason] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  async function bypass() {
    setState("sending");
    try {
      const res = await fetch("/api/approval/bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, reason }),
      });
      if (res.ok) {
        setState("done");
        // Reload the page so the banner updates.
        window.location.reload();
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error || "Could not bypass approval.");
        setState("error");
      }
    } catch {
      setErrorMsg("Network error.");
      setState("error");
    }
  }

  if (state === "done") return null;

  if (state === "confirming" || state === "sending" || state === "error") {
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", gap: "0.25rem", marginTop: "0.25rem" }}>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Bypass reason (required)"
          maxLength={500}
          style={{ padding: "0.25rem 0.5rem", fontSize: "0.85rem", border: "1px solid #e2e0d9", borderRadius: 3 }}
        />
        {errorMsg && <span style={{ color: "var(--red, #b91c1c)", fontSize: "0.82rem" }}>{errorMsg}</span>}
        <span>
          <button
            onClick={bypass}
            disabled={state === "sending" || !reason.trim()}
            style={{ background: "#b91c1c", color: "#fff", border: "none", padding: "4px 10px", borderRadius: 3, cursor: "pointer", fontSize: "0.85rem", marginRight: "0.5rem" }}
          >
            {state === "sending" ? "Bypassing..." : "Confirm bypass"}
          </button>
          <button
            onClick={() => { setState("idle"); setErrorMsg(""); }}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.85rem", color: "var(--mid)" }}
          >
            Cancel
          </button>
        </span>
      </span>
    );
  }

  return (
    <button
      onClick={() => setState("confirming")}
      style={{ background: "none", border: "none", color: "var(--red, #b91c1c)", textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: "inherit" }}
    >
      Emergency bypass
    </button>
  );
}

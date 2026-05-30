"use client";
import { useState } from "react";

export default function ApprovalPokeButton({ orderId }: { orderId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function poke() {
    setState("sending");
    try {
      const res = await fetch("/api/approval/poke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") return <span className="muted" style={{ fontSize: "0.85rem" }}>Reminder sent.</span>;
  if (state === "error") return <span style={{ color: "var(--red, #b91c1c)", fontSize: "0.85rem" }}>Could not send reminder.</span>;

  return (
    <button
      onClick={poke}
      disabled={state === "sending"}
      style={{ background: "none", border: "none", color: "var(--blue, #1d4ed8)", textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: "inherit" }}
    >
      {state === "sending" ? "Sending..." : "Remind approver"}
    </button>
  );
}

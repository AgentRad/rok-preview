"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function QuoteActions({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function accept() {
    setBusy("accept");
    setError("");
    const res = await fetch(`/api/quotes/${quoteId}/accept`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not accept the quote.");
      setBusy("");
      return;
    }
    router.push(`/orders/${data.orderId}`);
  }

  async function decline() {
    setBusy("decline");
    await fetch(`/api/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "decline" }),
    });
    router.refresh();
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      <button className="btn btn-primary btn-block" onClick={accept} disabled={!!busy}>
        {busy === "accept" ? "Creating order…" : "Accept quote & create order"}
      </button>
      <button
        className="btn btn-ghost btn-block"
        style={{ marginTop: 9 }}
        onClick={decline}
        disabled={!!busy}
      >
        Decline
      </button>
    </div>
  );
}

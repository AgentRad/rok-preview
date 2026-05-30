"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function QuoteResponder({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!(Number(price) > 0)) return;
    setBusy(true);
    const res = await fetch(`/api/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "quote", unitPrice: Number(price), note }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className="inline-form" style={{ flexWrap: "wrap", gap: 8 }}>
      <input
        className="input-sm"
        placeholder="Unit price $"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <input
        className="input-sm"
        style={{ width: 170 }}
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button className="btn btn-dark btn-sm" onClick={send} disabled={busy}>
        {busy ? "…" : "Send quote"}
      </button>
    </div>
  );
}

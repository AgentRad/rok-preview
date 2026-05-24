"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function cancel() {
    if (!confirm("Cancel this order? If it was paid, the order will be voided.")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not cancel the order.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={cancel}
        disabled={busy}
      >
        {busy ? "Cancelling…" : "Cancel order"}
      </button>
      {error && (
        <span className="muted-text" style={{ color: "var(--red)", marginLeft: 10, fontSize: 13 }}>
          {error}
        </span>
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ConfirmReceiptButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderId}/confirm-receipt`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not confirm receipt.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={confirm}
        disabled={busy}
      >
        {busy ? "Confirming…" : "✓ Confirm receipt"}
      </button>
      {error && (
        <div className="alert alert-error" style={{ marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  );
}

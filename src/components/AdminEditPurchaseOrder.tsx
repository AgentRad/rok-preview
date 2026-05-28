"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * PLH-3v: admin-only inline editor for Order.purchaseOrderNumber on the
 * order detail page. Posts to /api/ops/orders/[id] with action="po".
 */
export default function AdminEditPurchaseOrder({
  orderId,
  initial,
}: {
  orderId: string;
  initial: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch(`/api/ops/orders/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "po", purchaseOrderNumber: value.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save PO number.");
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 64))}
        maxLength={64}
        placeholder="PO number"
        style={{ maxWidth: 240 }}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={save}
        disabled={busy}
      >
        {busy ? "Saving" : "Save PO"}
      </button>
      {saved && (
        <span className="muted-text" style={{ fontSize: 12 }}>
          Saved.
        </span>
      )}
      {error && (
        <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>
      )}
    </div>
  );
}

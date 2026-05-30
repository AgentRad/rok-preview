"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Supplier-side "Mark shipped" form. Renders as a single button on incoming
 * orders. Clicking expands an inline form with carrier + tracking inputs;
 * submitting POSTs to /api/orders/[id]/fulfill which routes through the
 * shared markOrderShipped helper. Same end state as the admin ops console's
 * Shipped transition.
 */
export default function FulfillButton({
  orderId,
  slotId,
}: {
  orderId: string;
  // PLH-3g P8: the supplier dashboard passes the caller's own slot id so
  // markSlotShipped only flips that supplier's slice of a multi-supplier
  // order. The server falls back to the supplier's slot lookup when
  // omitted; passing it explicitly avoids the extra round-trip.
  slotId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderId}/fulfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carrier, trackingCode: tracking, slotId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not mark shipped.");
        return;
      }
      setOpen(false);
      setCarrier("");
      setTracking("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        className="btn btn-dark btn-sm"
        type="button"
        onClick={() => setOpen(true)}
      >
        Mark shipped
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="fulfill-form">
      <input
        type="text"
        placeholder="Carrier (e.g. UPS)"
        value={carrier}
        onChange={(e) => setCarrier(e.target.value)}
        required
        autoFocus
      />
      <input
        type="text"
        placeholder="Tracking number"
        value={tracking}
        onChange={(e) => setTracking(e.target.value)}
        required
      />
      <button
        type="submit"
        className="btn btn-dark btn-sm"
        disabled={busy || !carrier.trim() || !tracking.trim()}
      >
        {busy ? "Shipping…" : "Confirm"}
      </button>
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          setOpen(false);
          setError("");
        }}
        disabled={busy}
      >
        Cancel
      </button>
      {error && (
        <div className="alert alert-error" style={{ marginTop: 6, flexBasis: "100%" }}>
          {error}
        </div>
      )}
    </form>
  );
}

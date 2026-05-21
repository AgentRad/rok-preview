"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function FulfillButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function fulfill() {
    setBusy(true);
    const res = await fetch(`/api/orders/${orderId}/fulfill`, {
      method: "POST",
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <button className="btn btn-dark btn-sm" onClick={fulfill} disabled={busy}>
      {busy ? "…" : "Mark dispatched"}
    </button>
  );
}

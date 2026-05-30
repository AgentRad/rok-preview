"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MarkPayoutPaid({ payoutId }: { payoutId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function markPaid() {
    if (!confirm("Mark this payout as paid?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/payouts/${payoutId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark-paid" }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="btn btn-dark btn-sm"
      onClick={markPaid}
      disabled={busy}
    >
      {busy ? "…" : "Mark paid"}
    </button>
  );
}

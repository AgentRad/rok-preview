"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Action = "approve" | "reject" | "resolve";

/**
 * Polish 12 H5: approving a return triggers a refund through
 * refundOrder(). The admin now picks the refund amount (defaulting to
 * order total minus already-refunded, in dollars) before clicking
 * Approve. Reject + Resolve don't move money.
 */
export default function ReturnActions({
  returnId,
  defaultRefundCents,
}: {
  returnId: string;
  defaultRefundCents: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [refundDollars, setRefundDollars] = useState(
    (defaultRefundCents / 100).toFixed(2)
  );
  const [error, setError] = useState("");

  async function run(action: Action) {
    setBusy(true);
    setError("");
    try {
      const payload: Record<string, unknown> = { action, note };
      if (action === "approve") {
        const cents = Math.round(Number(refundDollars) * 100);
        if (!Number.isFinite(cents) || cents <= 0) {
          setError("Enter a positive refund amount in dollars.");
          setBusy(false);
          return;
        }
        payload.amountCents = cents;
      }
      const res = await fetch(`/api/returns/${returnId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Action failed.");
        setBusy(false);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="return-actions">
      {error && (
        <div
          className="alert alert-error"
          style={{ fontSize: 12, marginBottom: 6 }}
        >
          {error}
        </div>
      )}
      <input
        type="text"
        className="input-sm"
        placeholder="Internal note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="row-gap" style={{ marginTop: 6, alignItems: "center" }}>
        <label
          style={{ fontSize: 11, color: "var(--muted)", marginRight: 4 }}
        >
          Refund $
        </label>
        <input
          type="number"
          className="input-sm"
          style={{ width: 90 }}
          step="0.01"
          min="0"
          value={refundDollars}
          onChange={(e) => setRefundDollars(e.target.value)}
        />
      </div>
      <div className="row-gap" style={{ marginTop: 6 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => run("approve")}
          disabled={busy}
        >
          Approve + refund
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => run("reject")}
          disabled={busy}
        >
          Reject
        </button>
        <button
          type="button"
          className="btn btn-dark btn-sm"
          onClick={() => run("resolve")}
          disabled={busy}
        >
          Resolve
        </button>
      </div>
    </div>
  );
}

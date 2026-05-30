"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * PLH-3z-2: admin-only manual mark-paid control for a net-terms invoice that
 * is still DUE/PAST_DUE. Records an off-platform payment (wire/check/etc) via
 * POST /api/admin/invoices/[id]/payments. When the payment clears the balance
 * the invoice flips PAID and the order advances.
 */
export default function AdminRecordPayment({
  invoiceId,
  balanceDueDollars,
}: {
  invoiceId: string;
  balanceDueDollars: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(balanceDueDollars);
  const [method, setMethod] = useState("wire");
  const [reference, setReference] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/invoices/${invoiceId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountDollars: amount,
          method,
          reference: reference.trim(),
          receivedAt: receivedAt || undefined,
          notes: notes.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not record payment.");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ marginTop: 6 }}
        onClick={() => setOpen(true)}
      >
        Record payment
      </button>
    );
  }

  return (
    <div
      style={{
        marginTop: 8,
        padding: 12,
        border: "1px solid var(--line)",
        borderRadius: 8,
        textAlign: "left",
        maxWidth: 320,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
        Record off-platform payment
      </div>
      <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
        Amount (USD)
        <input
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: "100%", marginTop: 2 }}
        />
      </label>
      <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
        Method
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          style={{ width: "100%", marginTop: 2 }}
        >
          <option value="wire">Wire</option>
          <option value="check">Check</option>
          <option value="ach">ACH</option>
          <option value="card">Card</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
        Reference / check #
        <input
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value.slice(0, 200))}
          style={{ width: "100%", marginTop: 2 }}
        />
      </label>
      <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
        Date received
        <input
          type="date"
          value={receivedAt}
          onChange={(e) => setReceivedAt(e.target.value)}
          style={{ width: "100%", marginTop: 2 }}
        />
      </label>
      <label style={{ display: "block", fontSize: 12, marginBottom: 8 }}>
        Notes
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
          style={{ width: "100%", marginTop: 2 }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-dark btn-sm"
          onClick={submit}
          disabled={busy}
        >
          {busy ? "Saving" : "Save payment"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
      {error && (
        <div style={{ color: "var(--red)", fontSize: 12, marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  );
}

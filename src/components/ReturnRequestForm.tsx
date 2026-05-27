"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const REASONS = [
  "Damaged on arrival",
  "Wrong part received",
  "Defective / does not work",
  "Missing item",
  "Other",
];

export default function ReturnRequestForm({
  orderId,
  deliveredAt,
}: {
  orderId: string;
  deliveredAt?: string | null;
}) {
  // PLH-3c F5: surface the 30-day post-delivery return window so buyers
  // know how long they have left.
  let windowNote: string | null = null;
  if (deliveredAt) {
    const delivered = new Date(deliveredAt).getTime();
    const closes = delivered + 30 * 86400_000;
    const msLeft = closes - Date.now();
    if (msLeft <= 0) {
      windowNote = "The 30-day return window has closed. Contact support for warranty claims.";
    } else {
      const daysLeft = Math.max(1, Math.ceil(msLeft / 86400_000));
      windowNote = `${daysLeft} day${daysLeft === 1 ? "" : "s"} left to open a return.`;
    }
  }
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, reason, details }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not file the return request.");
        return;
      }
      setDone(data.reference || "OK");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="alert alert-ok">
        Return request {done} submitted. PartsPort support will follow up
        shortly.
      </div>
    );
  }

  if (!open) {
    return (
      <div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOpen(true)}
        >
          Report an issue with this order
        </button>
        {windowNote && (
          <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            {windowNote}
          </div>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="address-form"
      style={{ marginTop: 14 }}
    >
      <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 10 }}>
        Report an issue
      </h3>
      {windowNote && (
        <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
          {windowNote}
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-row">
        <label htmlFor="rr-reason">What happened?</label>
        <select
          id="rr-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          {REASONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="rr-details">Details (optional)</label>
        <textarea
          id="rr-details"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Photos, serial numbers, what you saw on the delivery receipt, anything that helps."
          maxLength={4000}
        />
      </div>
      <div className="row-gap" style={{ marginTop: 8 }}>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Submitting…" : "Submit request"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

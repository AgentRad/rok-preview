"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type BankInfoView = {
  bankInfoStatus: string;
  bankInfoLast4: string | null;
  bankInfoType: string | null;
  bankInfoBankName: string | null;
  bankInfoNote: string;
  bankInfoUpdatedAt: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  MISSING: "badge-pending",
  PENDING: "badge-pending",
  ON_FILE: "badge-fulfilled",
  REJECTED: "badge-cancelled",
};

const STATUS_LABEL: Record<string, string> = {
  MISSING: "Not submitted",
  PENDING: "Pending admin confirmation",
  ON_FILE: "On file",
  REJECTED: "Rejected",
};

export default function SupplierBankInfo({
  initial,
}: {
  initial: BankInfoView;
}) {
  const router = useRouter();
  const [bankName, setBankName] = useState(initial.bankInfoBankName || "");
  const [type, setType] = useState<string>(initial.bankInfoType || "CHECKING");
  const [last4, setLast4] = useState(initial.bankInfoLast4 || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [state, setState] = useState(initial);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk("");
    try {
      const res = await fetch("/api/supplier/bank-info", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankName, type, last4 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save.");
        return;
      }
      setState((prev) => ({
        ...prev,
        bankInfoStatus: data.supplier.bankInfoStatus,
        bankInfoLast4: data.supplier.bankInfoLast4,
        bankInfoType: data.supplier.bankInfoType,
        bankInfoBankName: data.supplier.bankInfoBankName,
        bankInfoNote: data.supplier.bankInfoNote,
        bankInfoUpdatedAt: data.supplier.bankInfoUpdatedAt,
      }));
      setOk(
        "Summary saved. Email full ACH details to admin@partsport.com (or upload as an Other document above). Admin will mark on file once received."
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const status = state.bankInfoStatus;
  const lastUpdated = state.bankInfoUpdatedAt
    ? new Date(state.bankInfoUpdatedAt).toLocaleDateString()
    : null;

  return (
    <form onSubmit={submit}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <span className={"badge " + (STATUS_BADGE[status] || "badge-pending")}>
          {STATUS_LABEL[status] || status}
        </span>
        {lastUpdated && (
          <span className="muted-text" style={{ fontSize: 12.5 }}>
            Updated {lastUpdated}
          </span>
        )}
      </div>

      <p className="muted-text" style={{ fontSize: 13, lineHeight: 1.55 }}>
        PartsPort doesn&rsquo;t store your full account or routing numbers.
        Enter the summary here so we can confirm it matches what you send,
        then email the full ACH details to{" "}
        <a
          href="mailto:admin@partsport.com"
          style={{ color: "var(--blue)", fontWeight: 600 }}
        >
          admin@partsport.com
        </a>{" "}
        (encrypted), or upload them as an Other document above. Admin marks
        the line on file once received.
      </p>

      <div className="form-row three" style={{ marginTop: 12 }}>
        <div>
          <label>Bank name</label>
          <input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="First National Bank"
            required
          />
        </div>
        <div>
          <label>Account type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="CHECKING">Checking</option>
            <option value="SAVINGS">Savings</option>
          </select>
        </div>
        <div>
          <label>Last 4 of account</label>
          <input
            value={last4}
            onChange={(e) =>
              setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            inputMode="numeric"
            placeholder="1234"
            maxLength={4}
            required
          />
        </div>
      </div>

      {state.bankInfoNote && (
        <div className="alert alert-info" style={{ marginTop: 10 }}>
          <strong>Admin note:</strong> {state.bankInfoNote}
        </div>
      )}
      {error && (
        <div className="alert alert-error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
      {ok && (
        <div className="alert alert-ok" style={{ marginTop: 10 }}>
          {ok}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Saving…" : "Save bank summary"}
        </button>
      </div>
    </form>
  );
}

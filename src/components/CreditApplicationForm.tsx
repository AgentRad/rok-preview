"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RefRow = { companyName: string; contact: string; phone: string; email: string };

const EMPTY_REF: RefRow = { companyName: "", contact: "", phone: "", email: "" };

export default function CreditApplicationForm({ orgName }: { orgName: string }) {
  const router = useRouter();
  const [legalName, setLegalName] = useState(orgName);
  const [dba, setDba] = useState("");
  const [ein, setEin] = useState("");
  const [yearsInBusiness, setYears] = useState("");
  const [requestedTerms, setTerms] = useState("NET_30");
  const [expectedMonthly, setExpectedMonthly] = useState("");
  const [requestedLimit, setRequestedLimit] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [apName, setApName] = useState("");
  const [apEmail, setApEmail] = useState("");
  const [apPhone, setApPhone] = useState("");
  const [w9, setW9] = useState("");
  const [duns, setDuns] = useState("");
  const [notes, setNotes] = useState("");
  const [refs, setRefs] = useState<RefRow[]>([{ ...EMPTY_REF }]);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function setRef(i: number, key: keyof RefRow, value: string) {
    setRefs((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }

  async function submit() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/credit-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalName,
          dba,
          ein,
          yearsInBusiness,
          requestedTerms,
          expectedMonthlyDollars: expectedMonthly,
          requestedLimitDollars: requestedLimit,
          billingAddress,
          apContactName: apName,
          apContactEmail: apEmail,
          apContactPhone: apPhone,
          w9BlobUrl: w9,
          dunsNumber: duns,
          notes,
          references: refs.filter((r) => r.companyName.trim().length > 0),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "Could not submit the application.");
        return;
      }
      setDone(data.reference || "");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="alert alert-success">
        Application <strong>{done}</strong> submitted. A PartsPort admin will
        review it and email the AP contact with the decision.
      </div>
    );
  }

  return (
    <form
      className="card"
      style={{ display: "grid", gap: "1rem", padding: "1.25rem" }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {err && <div className="alert alert-error">{err}</div>}

      <div className="field">
        <label>Company legal name</label>
        <input value={legalName} onChange={(e) => setLegalName(e.target.value)} required />
      </div>
      <div className="field">
        <label>DBA (optional)</label>
        <input value={dba} onChange={(e) => setDba(e.target.value)} />
      </div>
      <div className="row gap">
        <div className="field" style={{ flex: 1 }}>
          <label>EIN</label>
          <input value={ein} onChange={(e) => setEin(e.target.value)} required placeholder="12-3456789" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Years in business (optional)</label>
          <input value={yearsInBusiness} onChange={(e) => setYears(e.target.value)} inputMode="numeric" />
        </div>
      </div>

      <div className="row gap">
        <div className="field" style={{ flex: 1 }}>
          <label>Requested terms</label>
          <select value={requestedTerms} onChange={(e) => setTerms(e.target.value)}>
            <option value="NET_15">Net 15</option>
            <option value="NET_30">Net 30</option>
            <option value="NET_60">Net 60</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Requested credit limit (USD)</label>
          <input value={requestedLimit} onChange={(e) => setRequestedLimit(e.target.value)} inputMode="decimal" required placeholder="50000" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Expected monthly spend (USD)</label>
          <input value={expectedMonthly} onChange={(e) => setExpectedMonthly(e.target.value)} inputMode="decimal" required placeholder="20000" />
        </div>
      </div>

      <div className="field">
        <label>Billing address</label>
        <textarea value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} required rows={3} />
      </div>

      <div className="row gap">
        <div className="field" style={{ flex: 1 }}>
          <label>AP contact name</label>
          <input value={apName} onChange={(e) => setApName(e.target.value)} required />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>AP contact email</label>
          <input value={apEmail} onChange={(e) => setApEmail(e.target.value)} type="email" required />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>AP contact phone (optional)</label>
          <input value={apPhone} onChange={(e) => setApPhone(e.target.value)} />
        </div>
      </div>

      <fieldset style={{ border: "1px solid var(--hairline, #ddd)", padding: "0.75rem", borderRadius: 6 }}>
        <legend>Trade references</legend>
        {refs.map((r, i) => (
          <div key={i} className="row gap" style={{ marginBottom: "0.5rem" }}>
            <input placeholder="Company" value={r.companyName} onChange={(e) => setRef(i, "companyName", e.target.value)} style={{ flex: 2 }} />
            <input placeholder="Contact" value={r.contact} onChange={(e) => setRef(i, "contact", e.target.value)} style={{ flex: 1 }} />
            <input placeholder="Phone" value={r.phone} onChange={(e) => setRef(i, "phone", e.target.value)} style={{ flex: 1 }} />
            <input placeholder="Email" value={r.email} onChange={(e) => setRef(i, "email", e.target.value)} style={{ flex: 1 }} />
          </div>
        ))}
        {refs.length < 10 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRefs((p) => [...p, { ...EMPTY_REF }])}>
            Add another reference
          </button>
        )}
      </fieldset>

      <div className="row gap">
        <div className="field" style={{ flex: 1 }}>
          <label>W-9 URL (optional)</label>
          <input value={w9} onChange={(e) => setW9(e.target.value)} placeholder="https://" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>D-U-N-S number (optional)</label>
          <input value={duns} onChange={(e) => setDuns(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Notes (optional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </div>

      <div>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Submitting..." : "Submit application"}
        </button>
      </div>
    </form>
  );
}

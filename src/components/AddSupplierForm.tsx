"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Result = { supplierId: string; tempPassword: string | null };

export default function AddSupplierForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [certifications, setCertifications] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Result | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          contactName,
          contactEmail,
          certifications,
          sendEmail,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not create the supplier.");
        return;
      }
      setDone({ supplierId: data.supplierId, tempPassword: data.tempPassword });
      setCompanyName("");
      setContactName("");
      setContactEmail("");
      setCertifications("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Add a supplier directly</h2>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setOpen((s) => !s);
            setDone(null);
            setError("");
          }}
        >
          {open ? "Close" : "+ Add supplier"}
        </button>
      </div>
      {open && (
        <div className="card-body">
          {done ? (
            <div className="alert alert-ok" style={{ marginBottom: 14 }}>
              Supplier created. {sendEmail ? "Login email sent to the contact." : "No email sent (per your selection)."}
              {done.tempPassword && (
                <>
                  {" "}Temporary password (shown once):{" "}
                  <code style={{
                    fontFamily: "var(--mono)",
                    background: "var(--bg)",
                    border: "1px solid var(--line)",
                    padding: "2px 6px",
                    borderRadius: 3,
                  }}>{done.tempPassword}</code>
                </>
              )}
            </div>
          ) : null}
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={submit}>
            <div className="form-row two">
              <div>
                <label htmlFor="as-company">Company name</label>
                <input
                  id="as-company"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="as-cname">Owner full name</label>
                <input
                  id="as-cname"
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="form-row">
              <label htmlFor="as-email">Owner email (login)</label>
              <input
                id="as-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-row">
              <label htmlFor="as-certs">Certifications (optional)</label>
              <input
                id="as-certs"
                type="text"
                value={certifications}
                onChange={(e) => setCertifications(e.target.value)}
                placeholder="ISO 9001:2015, IEEE C57 compliant, etc."
              />
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
              />
              <span>Send welcome email with login details</span>
            </label>
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? "Creating…" : "Create supplier"}
              </button>
            </div>
          </form>
          <p className="muted-text" style={{ fontSize: 12.5, marginTop: 12 }}>
            The new account starts as the supplier OWNER and can invite the rest
            of the team from the supplier dashboard.
          </p>
        </div>
      )}
    </div>
  );
}

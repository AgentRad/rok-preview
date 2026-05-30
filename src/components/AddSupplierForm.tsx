"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Role = "OWNER" | "ADMIN" | "SALES" | "FULFILLMENT" | "CATALOG" | "FINANCE" | "VIEWER";

type Invite = { email: string; role: Role };

type Result = {
  supplierId: string;
  invites: Array<{ email: string; role: Role; status: string }>;
};

const ROLES: Array<{ value: Role; label: string }> = [
  { value: "OWNER", label: "Owner" },
  { value: "ADMIN", label: "Admin" },
  { value: "SALES", label: "Sales" },
  { value: "FULFILLMENT", label: "Fulfillment" },
  { value: "CATALOG", label: "Catalog" },
  { value: "FINANCE", label: "Finance" },
  { value: "VIEWER", label: "Viewer" },
];

export default function AddSupplierForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [certifications, setCertifications] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Result | null>(null);

  function addRow() {
    setInvites((list) => [...list, { email: "", role: "ADMIN" }]);
  }
  function removeRow(i: number) {
    setInvites((list) => list.filter((_, idx) => idx !== i));
  }
  function updateRow(i: number, patch: Partial<Invite>) {
    setInvites((list) =>
      list.map((row, idx) => (idx === i ? { ...row, ...patch } : row))
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const cleanInvites = invites
        .map((r) => ({ email: r.email.trim().toLowerCase(), role: r.role }))
        .filter((r) => r.email.includes("@"));
      const res = await fetch("/api/admin/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          contactName,
          contactEmail,
          website,
          logoUrl,
          description,
          certifications,
          sendEmail,
          invites: cleanInvites,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not create the supplier.");
        return;
      }
      setDone({
        supplierId: data.supplierId,
        invites: data.invites || [],
      });
      setCompanyName("");
      setContactName("");
      setContactEmail("");
      setWebsite("");
      setLogoUrl("");
      setDescription("");
      setCertifications("");
      setInvites([]);
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
              Supplier created.
              {sendEmail ? " A welcome email with a password-reset link has been sent." : " No email sent (per your selection)."}
              {done.invites.length > 0 && (
                <ul style={{ margin: "10px 0 0 18px", fontSize: 13 }}>
                  {done.invites.map((i) => (
                    <li key={i.email}>
                      {i.email} ({i.role.toLowerCase()}):{" "}
                      <em>
                        {i.status === "added"
                          ? "added immediately"
                          : i.status === "invited"
                            ? "invite email sent"
                            : "skipped"}
                      </em>
                    </li>
                  ))}
                </ul>
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
            <div className="form-row two">
              <div>
                <label htmlFor="as-website">Website</label>
                <input
                  id="as-website"
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://example.com"
                />
              </div>
              <div>
                <label htmlFor="as-logo">Logo URL</label>
                <input
                  id="as-logo"
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                />
              </div>
            </div>
            <div className="form-row">
              <label htmlFor="as-desc">Short description</label>
              <textarea
                id="as-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="One sentence about the company, shown on their supplier page."
                rows={2}
              />
            </div>
            <div className="form-row">
              <label htmlFor="as-certs">Certifications</label>
              <input
                id="as-certs"
                type="text"
                value={certifications}
                onChange={(e) => setCertifications(e.target.value)}
                placeholder="ISO 9001:2015, IEEE C57 compliant, etc."
              />
            </div>

            <div className="form-row">
              <label>Invite teammates (optional)</label>
              <p
                className="muted-text"
                style={{ fontSize: 12.5, marginBottom: 8 }}
              >
                Existing PartsPort users are added immediately. New emails get
                a one-time invite link that expires in 14 days.
              </p>
              {invites.map((row, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 8,
                    marginBottom: 8,
                    alignItems: "center",
                  }}
                >
                  <input
                    type="email"
                    placeholder="teammate@example.com"
                    value={row.email}
                    onChange={(e) => updateRow(i, { email: e.target.value })}
                    style={{ flex: 1 }}
                  />
                  <select
                    value={row.role}
                    onChange={(e) =>
                      updateRow(i, { role: e.target.value as Role })
                    }
                    style={{ flex: "0 0 160px" }}
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="link-btn link-btn-danger"
                    onClick={() => removeRow(i)}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={addRow}
              >
                + Add another teammate
              </button>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
              />
              <span>Send welcome email to the owner with login details</span>
            </label>
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? "Creating…" : "Create supplier"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

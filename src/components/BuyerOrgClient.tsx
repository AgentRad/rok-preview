"use client";

import { useState } from "react";
import { formatAddressBlock } from "@/lib/address";

type OrgAddress = {
  id: string;
  label: string;
  recipient: string;
  company: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string;
};

const BLANK = {
  label: "",
  recipient: "",
  company: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "US",
  phone: "",
};

export default function BuyerOrgClient({
  isAdmin,
  initialAddresses,
}: {
  isAdmin: boolean;
  initialAddresses: OrgAddress[];
}) {
  const [addresses, setAddresses] = useState<OrgAddress[]>(initialAddresses);
  const [form, setForm] = useState({ ...BLANK });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/buyer-org/addresses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not add the address.");
      return;
    }
    setAddresses((prev) => [{ id: data.id, ...form }, ...prev]);
    setForm({ ...BLANK });
    setShowForm(false);
  }

  async function remove(id: string) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/buyer-org/addresses/${id}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not remove the address.");
      return;
    }
    setAddresses((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-head">
        <h2>Shared shipping addresses</h2>
        {isAdmin && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowForm((s) => !s)}
          >
            {showForm ? "Cancel" : "Add address"}
          </button>
        )}
      </div>
      <div className="card-body">
        {error && <div className="alert alert-error">{error}</div>}
        {addresses.length === 0 ? (
          <p className="muted-text">
            No shared addresses yet.
            {isAdmin ? " Add one so any member can ship to it." : ""}
          </p>
        ) : (
          <div className="stack-list">
            {addresses.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <div style={{ whiteSpace: "pre-line", fontSize: 13.5 }}>
                  {a.label && (
                    <div style={{ fontWeight: 600 }}>{a.label}</div>
                  )}
                  {formatAddressBlock(a)}
                </div>
                {isAdmin && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => remove(a.id)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {isAdmin && showForm && (
          <form onSubmit={add} style={{ marginTop: 16 }}>
            <div className="form-row">
              <label htmlFor="oa-label">Label</label>
              <input
                id="oa-label"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. Main warehouse"
              />
            </div>
            <div className="form-row two">
              <div>
                <label htmlFor="oa-recipient">Recipient</label>
                <input
                  id="oa-recipient"
                  value={form.recipient}
                  onChange={(e) => setForm({ ...form, recipient: e.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="oa-company">Company</label>
                <input
                  id="oa-company"
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <label htmlFor="oa-line1">Street address</label>
              <input
                id="oa-line1"
                value={form.line1}
                onChange={(e) => setForm({ ...form, line1: e.target.value })}
                required
              />
            </div>
            <div className="form-row">
              <label htmlFor="oa-line2">Suite / unit</label>
              <input
                id="oa-line2"
                value={form.line2}
                onChange={(e) => setForm({ ...form, line2: e.target.value })}
              />
            </div>
            <div className="form-row two">
              <div>
                <label htmlFor="oa-city">City</label>
                <input
                  id="oa-city"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="oa-region">State / region</label>
                <input
                  id="oa-region"
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="form-row two">
              <div>
                <label htmlFor="oa-postal">Postal code</label>
                <input
                  id="oa-postal"
                  value={form.postalCode}
                  onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="oa-country">Country</label>
                <input
                  id="oa-country"
                  value={form.country}
                  onChange={(e) =>
                    setForm({ ...form, country: e.target.value.toUpperCase() })
                  }
                  maxLength={2}
                />
              </div>
            </div>
            <div className="form-row">
              <label htmlFor="oa-phone">Phone (optional)</label>
              <input
                id="oa-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save shared address"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

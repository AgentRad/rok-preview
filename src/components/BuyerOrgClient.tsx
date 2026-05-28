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

type TaxExempt = {
  status: string | null;
  certificateUrl: string | null;
  expiresAt: string | null;
};

type Billing = {
  mode: "MEMBER_PAYS" | "HYBRID";
  hasStripeCustomer: boolean;
};

export default function BuyerOrgClient({
  isAdmin,
  taxExempt,
  billing,
  initialAddresses,
}: {
  isAdmin: boolean;
  taxExempt: TaxExempt;
  billing: Billing;
  initialAddresses: OrgAddress[];
}) {
  const [addresses, setAddresses] = useState<OrgAddress[]>(initialAddresses);
  const [form, setForm] = useState({ ...BLANK });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [billingMode, setBillingMode] = useState(billing.mode);
  const [hasCustomer, setHasCustomer] = useState(billing.hasStripeCustomer);
  const [billingError, setBillingError] = useState("");
  const [billingBusy, setBillingBusy] = useState(false);

  async function setMode(mode: "MEMBER_PAYS" | "HYBRID") {
    setBillingBusy(true);
    setBillingError("");
    const res = await fetch("/api/buyer-org/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billingMode: mode }),
    });
    const data = await res.json().catch(() => ({}));
    setBillingBusy(false);
    if (!res.ok) {
      setBillingError(data.error || "Could not update billing mode.");
      return;
    }
    setBillingMode(mode);
    setHasCustomer(!!data.hasStripeCustomer);
  }

  const [cert, setCert] = useState<TaxExempt>(taxExempt);
  const [certUrl, setCertUrl] = useState("");
  const [certExpiry, setCertExpiry] = useState("");
  const [certError, setCertError] = useState("");
  const [certBusy, setCertBusy] = useState(false);

  async function saveCert(e: React.FormEvent) {
    e.preventDefault();
    setCertBusy(true);
    setCertError("");
    const res = await fetch("/api/buyer-org/tax-exempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: certUrl, expiresAt: certExpiry || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setCertBusy(false);
    if (!res.ok) {
      setCertError(data.error || "Could not save the certificate.");
      return;
    }
    setCert({
      status: "PENDING",
      certificateUrl: certUrl,
      expiresAt: certExpiry || null,
    });
    setCertUrl("");
    setCertExpiry("");
  }

  async function clearCert() {
    setCertBusy(true);
    setCertError("");
    const res = await fetch("/api/buyer-org/tax-exempt", { method: "DELETE" });
    setCertBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setCertError(data.error || "Could not clear the certificate.");
      return;
    }
    setCert({ status: null, certificateUrl: null, expiresAt: null });
  }

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

  const certStatusLabel = cert.status
    ? cert.status === "APPROVED"
      ? "Approved"
      : cert.status === "REJECTED"
        ? "Rejected"
        : "Pending review"
    : "None on file";

  return (
    <>
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-head">
        <h2>Billing</h2>
        <span className="muted-text" style={{ fontSize: 13 }}>
          {billingMode === "HYBRID" ? "Hybrid (org card available)" : "Members pay"}
        </span>
      </div>
      <div className="card-body">
        {billingError && <div className="alert alert-error">{billingError}</div>}
        <p className="muted-text" style={{ fontSize: 13 }}>
          {billingMode === "HYBRID"
            ? "Permitted members can charge the org card at checkout, or still pay with their own card."
            : "Each member pays with their own card. Switch to hybrid to add a centralized org card."}
        </p>
        {isAdmin && (
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            {billingMode === "MEMBER_PAYS" ? (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setMode("HYBRID")}
                disabled={billingBusy}
              >
                {billingBusy ? "Enabling…" : "Enable hybrid billing"}
              </button>
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setMode("MEMBER_PAYS")}
                disabled={billingBusy}
              >
                {billingBusy ? "Switching…" : "Switch to members pay"}
              </button>
            )}
          </div>
        )}
        {billingMode === "HYBRID" && !hasCustomer && (
          <p className="muted-text" style={{ fontSize: 12, marginTop: 8 }}>
            No org card on file yet. The org Stripe customer is created when
            hybrid billing is enabled on a Stripe-configured environment.
          </p>
        )}
      </div>
    </div>

    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-head">
        <h2>Tax-exempt certificate</h2>
        <span className="muted-text" style={{ fontSize: 13 }}>{certStatusLabel}</span>
      </div>
      <div className="card-body">
        {certError && <div className="alert alert-error">{certError}</div>}
        <p className="muted-text" style={{ fontSize: 13 }}>
          An approved org certificate waives sales tax for every member's
          orders. It applies in addition to any personal certificate a member
          has on file.
        </p>
        {cert.certificateUrl ? (
          <div style={{ marginTop: 8, fontSize: 13.5 }}>
            <a
              href={cert.certificateUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
            >
              View certificate &rarr;
            </a>
            {cert.expiresAt && (
              <span className="muted-text" style={{ marginLeft: 8 }}>
                Expires {new Date(cert.expiresAt).toLocaleDateString()}
              </span>
            )}
            {isAdmin && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={clearCert}
                disabled={certBusy}
                style={{ marginLeft: 12 }}
              >
                Clear
              </button>
            )}
          </div>
        ) : (
          <p className="muted-text" style={{ fontSize: 13, marginTop: 8 }}>
            No certificate on file.
          </p>
        )}
        {isAdmin && (
          <form onSubmit={saveCert} style={{ marginTop: 12 }}>
            <div className="form-row">
              <label htmlFor="cert-url">Certificate URL (https)</label>
              <input
                id="cert-url"
                value={certUrl}
                onChange={(e) => setCertUrl(e.target.value)}
                placeholder="https://…"
                required
              />
            </div>
            <div className="form-row">
              <label htmlFor="cert-exp">Expiry date (optional)</label>
              <input
                id="cert-exp"
                type="date"
                value={certExpiry}
                onChange={(e) => setCertExpiry(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" disabled={certBusy}>
              {certBusy ? "Saving…" : "Submit certificate for review"}
            </button>
          </form>
        )}
      </div>
    </div>

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
    </>
  );
}

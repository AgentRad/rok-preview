"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

function TaxExemptRow({ address }: { address: Address }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showUrlPaste, setShowUrlPaste] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const status = address.taxExemptStatus;
  const url = address.taxExemptCertificateUrl;

  async function upload(file: File) {
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api/addresses/${address.id}/tax-exempt`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Upload failed.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitUrl() {
    if (!urlDraft.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/addresses/${address.id}/tax-exempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlDraft.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save the URL.");
        return;
      }
      setUrlDraft("");
      setShowUrlPaste(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!confirm("Remove the tax-exempt certificate from this address?")) return;
    setBusy(true);
    try {
      await fetch(`/api/addresses/${address.id}/tax-exempt`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const badge =
    status === "APPROVED"
      ? <span className="badge badge-fulfilled">Tax-exempt approved</span>
      : status === "PENDING"
        ? <span className="badge badge-pending">Tax-exempt under review</span>
        : status === "REJECTED"
          ? <span className="badge badge-cancelled">Tax-exempt rejected</span>
          : null;

  // PLH-2 Phase 4d (D4): private blob. The buyer hits the download
  // route, which auths and streams the bytes back.
  const certHref = url ? `/api/addresses/${address.id}/tax-exempt/download` : "";

  return (
    <div style={{ marginTop: 10, fontSize: 12.5 }}>
      {badge && <div style={{ marginBottom: 6 }}>{badge}</div>}
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
      <div className="muted-text" style={{ fontSize: 12, lineHeight: 1.45 }}>
        {url ? (
          <>
            <a href={certHref} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue)" }}>
              View certificate
            </a>
            {" · "}
            <button
              type="button"
              className="link-btn"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              Replace
            </button>
            {" · "}
            <button
              type="button"
              className="link-btn link-btn-danger"
              onClick={clear}
              disabled={busy}
            >
              Remove
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="link-btn"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              {busy ? "Uploading…" : "Upload tax-exempt certificate"}
            </button>
            {" · "}
            <button
              type="button"
              className="link-btn"
              onClick={() => setShowUrlPaste((s) => !s)}
              disabled={busy}
            >
              {showUrlPaste ? "Hide URL option" : "Paste a URL"}
            </button>
          </>
        )}
      </div>
      {showUrlPaste && !url && (
        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
          <input
            type="url"
            className="input-sm"
            style={{ flex: 1 }}
            placeholder="https://… link to your hosted certificate"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={submitUrl}
            disabled={busy || !urlDraft.trim()}
          >
            Save URL
          </button>
        </div>
      )}
      {error && (
        <div className="alert alert-error" style={{ marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  );
}

export type Address = {
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
  isDefault: boolean;
  taxExemptCertificateUrl?: string | null;
  taxExemptStatus?: string | null;
};

// PLH-2 Phase 4d (D4): curated country list. Server still enforces ISO
// alpha-2 on submit, so "Other…" lets the buyer type any 2-letter code.
const COUNTRY_CODES = [
  "US", "CA", "MX", "GB", "IE", "DE", "FR", "ES", "IT", "NL",
  "BE", "CH", "SE", "NO", "DK", "FI", "PL", "AU", "NZ", "JP",
];
const COUNTRY_NAMES: Record<string, string> = {
  US: "United States", CA: "Canada", MX: "Mexico", GB: "United Kingdom",
  IE: "Ireland", DE: "Germany", FR: "France", ES: "Spain", IT: "Italy",
  NL: "Netherlands", BE: "Belgium", CH: "Switzerland", SE: "Sweden",
  NO: "Norway", DK: "Denmark", FI: "Finland", PL: "Poland",
  AU: "Australia", NZ: "New Zealand", JP: "Japan",
};

type Draft = Omit<Address, "id" | "isDefault"> & { isDefault: boolean };

const EMPTY: Draft = {
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
  isDefault: false,
};

export default function AddressBook({ initial }: { initial: Address[] }) {
  const router = useRouter();
  const [addresses, setAddresses] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save the address.");
        return;
      }
      setAddresses((list) =>
        data.address.isDefault
          ? [data.address, ...list.map((a) => ({ ...a, isDefault: false }))]
          : [...list, data.address]
      );
      setDraft(EMPTY);
      setAdding(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this address?")) return;
    const res = await fetch(`/api/addresses/${id}`, { method: "DELETE" });
    if (res.ok) {
      setAddresses((list) => list.filter((a) => a.id !== id));
      router.refresh();
    }
  }

  async function makeDefault(id: string) {
    const res = await fetch(`/api/addresses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-default" }),
    });
    if (res.ok) {
      setAddresses((list) =>
        list.map((a) => ({ ...a, isDefault: a.id === id }))
      );
      router.refresh();
    }
  }

  return (
    <div>
      {addresses.length === 0 ? (
        <div className="empty-block">
          <h3>No saved addresses</h3>
          <p>Save delivery addresses for faster checkout.</p>
        </div>
      ) : (
        <div className="address-grid">
          {addresses.map((a) => (
            <div key={a.id} className="address-card">
              <div className="address-head">
                <div>
                  <div className="invoice-meta-label">
                    {a.label || (a.isDefault ? "Default address" : "Address")}
                  </div>
                  <div style={{ fontWeight: 700, marginTop: 4 }}>
                    {a.recipient}
                  </div>
                  {a.company && (
                    <div className="muted-text" style={{ fontSize: 13 }}>
                      {a.company}
                    </div>
                  )}
                </div>
                {a.isDefault && (
                  <span className="badge badge-paid">Default</span>
                )}
              </div>
              <div style={{ fontSize: 13.5, marginTop: 8, color: "var(--ink-soft)" }}>
                {a.line1}
                {a.line2 ? <><br />{a.line2}</> : null}
                <br />
                {a.city}, {a.region} {a.postalCode}
                {a.country && a.country !== "US" ? <><br />{a.country}</> : null}
                {a.phone ? <><br /><span className="muted-text">{a.phone}</span></> : null}
              </div>
              <TaxExemptRow address={a} />
              <div className="address-actions">
                {!a.isDefault && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => makeDefault(a.id)}
                  >
                    Make default
                  </button>
                )}
                <button
                  type="button"
                  className="link-btn link-btn-danger"
                  onClick={() => remove(a.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <form onSubmit={save} className="address-form">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>
            Add an address
          </h3>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-row two">
            <div>
              <label htmlFor="ad-label">Label (optional)</label>
              <input
                id="ad-label"
                type="text"
                value={draft.label}
                onChange={(e) => patch("label", e.target.value)}
                placeholder="HQ, Warehouse, Field site"
              />
            </div>
            <div>
              <label htmlFor="ad-recipient">Recipient</label>
              <input
                id="ad-recipient"
                type="text"
                value={draft.recipient}
                onChange={(e) => patch("recipient", e.target.value)}
                required
              />
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="ad-company">Company (optional)</label>
            <input
              id="ad-company"
              type="text"
              value={draft.company}
              onChange={(e) => patch("company", e.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="ad-line1">Street address</label>
            <input
              id="ad-line1"
              type="text"
              value={draft.line1}
              onChange={(e) => patch("line1", e.target.value)}
              required
            />
          </div>
          <div className="form-row">
            <label htmlFor="ad-line2">Suite, unit, building (optional)</label>
            <input
              id="ad-line2"
              type="text"
              value={draft.line2}
              onChange={(e) => patch("line2", e.target.value)}
            />
          </div>
          <div className="form-row two">
            <div>
              <label htmlFor="ad-city">City</label>
              <input
                id="ad-city"
                type="text"
                value={draft.city}
                onChange={(e) => patch("city", e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="ad-region">State / region</label>
              <input
                id="ad-region"
                type="text"
                value={draft.region}
                onChange={(e) => patch("region", e.target.value)}
                required
              />
            </div>
          </div>
          <div className="form-row two">
            <div>
              <label htmlFor="ad-zip">Postal code</label>
              <input
                id="ad-zip"
                type="text"
                value={draft.postalCode}
                onChange={(e) => patch("postalCode", e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="ad-country">Country</label>
              {/* PLH-2 Phase 4d (D4): ISO alpha-2 select. Server validates. */}
              <select
                id="ad-country"
                value={COUNTRY_CODES.includes(draft.country) ? draft.country : "OTHER"}
                onChange={(e) => {
                  const v = e.target.value;
                  patch("country", v === "OTHER" ? "" : v);
                }}
              >
                {COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {COUNTRY_NAMES[code] || code} ({code})
                  </option>
                ))}
                <option value="OTHER">Other…</option>
              </select>
              {!COUNTRY_CODES.includes(draft.country) && (
                <input
                  type="text"
                  value={draft.country}
                  onChange={(e) => patch("country", e.target.value.toUpperCase())}
                  placeholder="2-letter ISO code"
                  maxLength={2}
                  style={{ marginTop: 6 }}
                />
              )}
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="ad-phone">Phone (optional)</label>
            <input
              id="ad-phone"
              type="tel"
              value={draft.phone}
              onChange={(e) => patch("phone", e.target.value)}
            />
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.isDefault}
              onChange={(e) => patch("isDefault", e.target.checked)}
            />
            <span>Use as the default delivery address</span>
          </label>
          <div className="row-gap" style={{ marginTop: 14 }}>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save address"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setAdding(false);
                setDraft(EMPTY);
                setError("");
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div style={{ marginTop: 18 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
            + Add an address
          </button>
        </div>
      )}
    </div>
  );
}

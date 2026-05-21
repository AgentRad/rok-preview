"use client";

import { useState } from "react";

export default function ManufacturerForm() {
  const [form, setForm] = useState({
    companyName: "",
    website: "",
    contactName: "",
    email: "",
    message: "",
  });
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        category: "Manufacturer / OEM",
        yearsTrading: "—",
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not submit.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="form-card">
        <div className="alert alert-ok" style={{ marginBottom: 0 }}>
          ✓ Thanks — our partnerships team will reach out to set up your
          manufacturer storefront and verify your authorized distributors.
        </div>
      </div>
    );
  }

  return (
    <div className="form-card">
      <h2>List your brand on PartsPort</h2>
      <p className="form-intro">
        Tell us about your company. We set up your storefront and verify your
        authorized distributors — no cost, and no channel conflict.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={submit}>
        <div className="form-row two">
          <div>
            <label htmlFor="mf-co">Company name</label>
            <input id="mf-co" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} required />
          </div>
          <div>
            <label htmlFor="mf-web">Website</label>
            <input id="mf-web" type="url" value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" />
          </div>
        </div>
        <div className="form-row two">
          <div>
            <label htmlFor="mf-name">Contact name</label>
            <input id="mf-name" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} required />
          </div>
          <div>
            <label htmlFor="mf-email">Work email</label>
            <input id="mf-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
          </div>
        </div>
        <div className="form-row">
          <label htmlFor="mf-msg">Product lines &amp; distribution</label>
          <textarea
            id="mf-msg"
            value={form.message}
            onChange={(e) => set("message", e.target.value)}
            placeholder="What you manufacture, and the distributors who carry your brand…"
          />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Submitting…" : "Request a manufacturer storefront"}
        </button>
      </form>
    </div>
  );
}

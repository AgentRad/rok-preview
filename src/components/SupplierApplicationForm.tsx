"use client";

import { useState } from "react";

const CATEGORIES = [
  "Bearings", "Hydraulics", "Pneumatics", "Motors & Drives", "Electrical",
  "Belts & Pulleys", "Sensors", "Valves", "Fasteners", "Power Transmission",
  "Seals & Gaskets", "Cutting Tools", "Other / multiple",
];

export default function SupplierApplicationForm() {
  const [form, setForm] = useState({
    companyName: "",
    website: "",
    contactName: "",
    email: "",
    category: CATEGORIES[0],
    yearsTrading: "2 – 5 years",
    certs: "",
    message: "",
  });
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not submit application.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="form-card">
        <div className="alert alert-ok" style={{ marginBottom: 0 }}>
          ✓ Application received. Our supplier team reviews submissions and an
          admin will approve qualified suppliers from the PartsPort console.
        </div>
      </div>
    );
  }

  return (
    <div className="form-card">
      <h2>Apply to become a supplier</h2>
      <p className="form-intro">
        Tell us about your company. Qualified applicants are approved by the
        PartsPort team and given supplier dashboard access.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={submit}>
        <div className="form-row two">
          <div>
            <label>Company name</label>
            <input
              type="text"
              value={form.companyName}
              onChange={(e) => set("companyName", e.target.value)}
              required
            />
          </div>
          <div>
            <label>Company website</label>
            <input
              type="url"
              value={form.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="https://"
            />
          </div>
        </div>
        <div className="form-row two">
          <div>
            <label>Contact name</label>
            <input
              type="text"
              value={form.contactName}
              onChange={(e) => set("contactName", e.target.value)}
              required
            />
          </div>
          <div>
            <label>Work email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              required
            />
          </div>
        </div>
        <div className="form-row two">
          <div>
            <label>Primary part category</label>
            <select
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Years trading</label>
            <select
              value={form.yearsTrading}
              onChange={(e) => set("yearsTrading", e.target.value)}
            >
              <option>Less than 2 years</option>
              <option>2 – 5 years</option>
              <option>5 – 10 years</option>
              <option>10+ years</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <label>Certifications held</label>
          <input
            type="text"
            value={form.certs}
            onChange={(e) => set("certs", e.target.value)}
            placeholder="e.g. ISO 9001:2015, authorized distributor for…"
          />
        </div>
        <div className="form-row">
          <label>Anything else we should know?</label>
          <textarea
            value={form.message}
            onChange={(e) => set("message", e.target.value)}
            placeholder="Inventory size, brands carried, typical lead times…"
          />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Submitting…" : "Submit application"}
        </button>
      </form>
    </div>
  );
}

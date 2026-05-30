"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ProfileForm({
  initialName,
  email,
  manufacturerName,
  showManufacturerName,
}: {
  initialName: string;
  email: string;
  manufacturerName: string;
  showManufacturerName: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [mfr, setMfr] = useState(manufacturerName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [warning, setWarning] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    setWarning("");
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          ...(showManufacturerName ? { manufacturerName: mfr } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save.");
        return;
      }
      setSaved(true);
      // Server can return a soft warning, e.g. when the OEM brand name
      // doesn't match any Product.manufacturer string yet (empty storefront).
      if (typeof data.warning === "string" && data.warning) {
        setWarning(data.warning);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="alert alert-error">{error}</div>}
      {saved && <div className="alert alert-ok">Profile updated.</div>}
      {warning && <div className="alert alert-info">{warning}</div>}
      <div className="form-row">
        <label htmlFor="pf-name">Full name</label>
        <input
          id="pf-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="form-row">
        <label htmlFor="pf-email">Email</label>
        <input id="pf-email" type="email" value={email} disabled readOnly />
        <p className="muted-text" style={{ fontSize: 12.5, marginTop: 4 }}>
          Email is the login identifier; not editable from here. Contact
          support to change it.
        </p>
      </div>
      {showManufacturerName && (
        <div className="form-row">
          <label htmlFor="pf-mfr">Manufacturer name</label>
          <input
            id="pf-mfr"
            type="text"
            value={mfr}
            onChange={(e) => setMfr(e.target.value)}
            placeholder="e.g. Siemens"
          />
        </div>
      )}
      <button className="btn btn-primary btn-sm" disabled={busy}>
        {busy ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}

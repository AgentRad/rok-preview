"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Buyer company profile: name + logo. Logo upload uses Vercel Blob when
 * configured; falls back to a hosted-URL paste when not. Mirrors the
 * supplier and OEM logo flows for consistency.
 *
 * The logo and name flow onto every new order the buyer places, snapshotted
 * onto Order.buyerCompanyName / Order.buyerCompanyLogoUrl so old invoices
 * keep their original branding even if the buyer changes them later.
 */
export default function CompanyProfileForm({
  initialName,
  initialLogoUrl,
  blobConfigured,
}: {
  initialName: string;
  initialLogoUrl: string | null;
  blobConfigured: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [urlDraft, setUrlDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function saveName() {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      // PATCH the profile route. It preserves user.name (we send it back
      // unchanged) and just updates companyName + optionally companyLogoUrl.
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Omit `name` so the PATCH only touches the company fields. The
          // route was updated to treat name as optional on PATCH.
          companyName: name,
          ...(urlDraft ? { companyLogoUrl: urlDraft } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save.");
        return;
      }
      if (urlDraft) {
        setLogoUrl(urlDraft);
        setUrlDraft("");
      }
      setSaved("Saved.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file: File) {
    setBusy(true);
    setError("");
    setSaved("");
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/account/company-logo", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Upload failed.");
        return;
      }
      setLogoUrl(data.logoUrl);
      setSaved("Logo uploaded.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clearLogo() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyLogoUrl: "" }),
      });
      if (res.ok) {
        setLogoUrl(null);
        setSaved("Logo removed.");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="logo-uploader">
      <div className="logo-preview" aria-label={`${name || "Company"} logo`}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={`${name || "Company"} logo`} />
        ) : (
          <div className="logo-placeholder">
            {(name || "CO").slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
          Company profile
        </div>
        <div className="muted-text" style={{ fontSize: 13, marginTop: 4 }}>
          Your company name and logo appear on checkout, on every order
          confirmation, and on the printed invoice. Optional, but it makes
          your team&rsquo;s POs look like POs.
        </div>

        <div className="form-row" style={{ marginTop: 14 }}>
          <label htmlFor="cp-name">Company name</label>
          <input
            id="cp-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Bend Electric Co-op"
            maxLength={200}
          />
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/svg+xml,image/png,image/jpeg,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadFile(f);
            e.target.value = "";
          }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => fileInput.current?.click()}
            disabled={busy || !blobConfigured}
            title={!blobConfigured ? "Vercel Blob not configured" : undefined}
          >
            {logoUrl ? "Replace logo" : "Upload logo"}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={saveName}
            disabled={busy}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {logoUrl && (
            <button
              type="button"
              className="link-btn link-btn-danger"
              onClick={clearLogo}
              disabled={busy}
            >
              Remove logo
            </button>
          )}
        </div>

        {!blobConfigured && (
          <div style={{ marginTop: 12 }}>
            <label className="muted-text" style={{ fontSize: 12 }}>
              Paste a hosted logo URL (Vercel Blob not enabled here):
            </label>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <input
                type="url"
                placeholder="https://… logo URL"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={saveName}
                disabled={busy || !urlDraft.trim()}
              >
                Save URL
              </button>
            </div>
          </div>
        )}
        {saved && !error && (
          <div className="alert alert-ok" style={{ marginTop: 10 }}>
            {saved}
          </div>
        )}
        {error && (
          <div className="alert alert-error" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function OemProfileEditor({
  brand,
  slug,
  initial,
}: {
  brand: string;
  slug: string;
  initial: {
    tagline: string;
    bio: string;
    website: string;
    logoUrl: string | null;
  };
}) {
  const router = useRouter();
  const [tagline, setTagline] = useState(initial.tagline);
  const [bio, setBio] = useState(initial.bio);
  const [website, setWebsite] = useState(initial.website);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function save() {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const res = await fetch("/api/oem/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagline, bio, website }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save.");
        return;
      }
      setSaved("Saved. Your public page is updated.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    setBusy(true);
    setError("");
    setSaved("");
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/oem/profile/logo", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Upload failed.");
        return;
      }
      setLogoUrl(data.logoUrl);
      setSaved("Logo updated.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clearLogo() {
    setBusy(true);
    try {
      const res = await fetch("/api/oem/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: "" }),
      });
      if (res.ok) {
        setLogoUrl(null);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="oem-editor">
      <div className="oem-editor-head">
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            Public storefront editor
          </div>
          <div className="muted-text" style={{ fontSize: 12.5, marginTop: 2 }}>
            What buyers see at{" "}
            <Link
              href={`/manufacturers/${slug}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
            >
              /manufacturers/{slug} &rarr;
            </Link>
          </div>
        </div>
      </div>

      <div className="oem-editor-grid">
        <div className="oem-editor-logo">
          <div className="logo-preview" aria-label={`${brand} logo`}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={`${brand} logo`} />
            ) : (
              <div className="logo-placeholder">
                {brand.slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/svg+xml,image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadLogo(f);
              e.target.value = "";
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              {logoUrl ? "Replace" : "Upload logo"}
            </button>
            {logoUrl && (
              <button
                type="button"
                className="link-btn link-btn-danger"
                onClick={clearLogo}
                disabled={busy}
              >
                Remove
              </button>
            )}
          </div>
          <div className="muted-text" style={{ fontSize: 11.5, marginTop: 8 }}>
            SVG (best) or PNG, square, under 2 MB.
          </div>
        </div>

        <div className="oem-editor-fields">
          <label className="oem-field">
            <span className="oem-field-label">Tagline</span>
            <input
              type="text"
              maxLength={140}
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="One-line positioning statement (140 chars max)"
            />
            <span className="oem-field-help">
              Shows under your name on the public storefront.
            </span>
          </label>

          <label className="oem-field">
            <span className="oem-field-label">About</span>
            <textarea
              rows={5}
              maxLength={1200}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="What you make, where you make it, what sets you apart. 1-2 paragraphs."
            />
            <span className="oem-field-help">
              {bio.length} / 1200 characters
            </span>
          </label>

          <label className="oem-field">
            <span className="oem-field-label">Website</span>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://your-company.com"
            />
          </label>

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={save}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save profile"}
            </button>
            <Link
              href={`/manufacturers/${slug}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost btn-sm"
            >
              View public page
            </Link>
          </div>
          {saved && !error && (
            <div className="alert alert-ok" style={{ marginTop: 8 }}>
              {saved}
            </div>
          )}
          {error && (
            <div className="alert alert-error" style={{ marginTop: 8 }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

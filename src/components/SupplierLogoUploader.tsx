"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function SupplierLogoUploader({
  initialLogoUrl,
  supplierName,
}: {
  initialLogoUrl: string | null;
  supplierName: string;
}) {
  const router = useRouter();
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/supplier/profile/logo", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Upload failed.");
        return;
      }
      setLogoUrl(data.logoUrl);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/supplier/profile", {
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
    <div className="logo-uploader">
      <div className="logo-preview" aria-label={`${supplierName} logo`}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={`${supplierName} logo`} />
        ) : (
          <div className="logo-placeholder">
            {supplierName.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
          {logoUrl ? "Company logo" : "Add a company logo"}
        </div>
        <div className="muted-text" style={{ fontSize: 12.5, marginTop: 2 }}>
          Shows next to your name on product cards and listings. Recommend a
          square image, around 400×400, under 2 MB.
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
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
            {busy ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
          </button>
          {logoUrl && (
            <button
              type="button"
              className="link-btn link-btn-danger"
              onClick={clear}
              disabled={busy}
            >
              Remove
            </button>
          )}
        </div>
        {error && (
          <div className="alert alert-error" style={{ marginTop: 8 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

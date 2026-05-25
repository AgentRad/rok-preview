"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Logo upload contract:
 *   - File type: SVG (preferred, infinite clarity), PNG (recommended for raster),
 *     JPG / JPEG, WEBP.
 *   - File size: under 2 MB.
 *   - Dimensions: minimum 256 x 256, maximum 2000 x 2000 pixels.
 *   - Aspect ratio: roughly square (between 4:5 and 5:4). The slot on
 *     product cards and the invoice is a 1:1 square; very wide or very tall
 *     logos crop awkwardly.
 *   - SVG bypasses the dimension check (vector scales perfectly).
 *
 * Validation runs client-side BEFORE the upload hits the server. That keeps
 * the failure tight and avoids a wasted Vercel Blob round-trip. The server
 * still enforces type + size as a safety net.
 */

const MIN_DIMENSION = 256;
const MAX_DIMENSION = 2000;
const MAX_BYTES = 2 * 1024 * 1024;
const MIN_ASPECT = 0.8;
const MAX_ASPECT = 1.25;
const ALLOWED_TYPES = new Set([
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

type ValidationResult =
  | { ok: true; width: number; height: number }
  | { ok: false; error: string };

async function validateLogo(file: File): Promise<ValidationResult> {
  if (!ALLOWED_TYPES.has(file.type)) {
    return {
      ok: false,
      error: "Use SVG (best), PNG, JPG, or WEBP.",
    };
  }
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Max 2 MB.`,
    };
  }
  if (file.size < 200) {
    // Either an empty file, a 1px transparent placeholder, or a stripped icon.
    // Be specific so the supplier knows what to fix.
    return {
      ok: false,
      error:
        "File is unusually small (under 200 bytes). Export a real logo, not a placeholder.",
    };
  }
  // SVG: skip pixel dimension check; vector scales.
  if (file.type === "image/svg+xml") {
    return { ok: true, width: 0, height: 0 };
  }
  // Raster: load and read natural dimensions.
  const url = URL.createObjectURL(file);
  try {
    const dims = await new Promise<{ width: number; height: number }>(
      (resolve, reject) => {
        const img = new Image();
        img.onload = () =>
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error("Could not read the image."));
        img.src = url;
      }
    );
    if (dims.width < MIN_DIMENSION || dims.height < MIN_DIMENSION) {
      return {
        ok: false,
        error: `Logo is ${dims.width}×${dims.height}. Minimum is ${MIN_DIMENSION}×${MIN_DIMENSION} so it stays sharp on invoices and product cards.`,
      };
    }
    if (dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION) {
      return {
        ok: false,
        error: `Logo is ${dims.width}×${dims.height}. Maximum is ${MAX_DIMENSION}×${MAX_DIMENSION}.`,
      };
    }
    const aspect = dims.width / dims.height;
    if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) {
      return {
        ok: false,
        error: `Logo aspect is ${aspect.toFixed(2)}:1. Use a roughly square image (between 4:5 and 5:4). Wide wordmarks crop poorly on cards.`,
      };
    }
    return { ok: true, width: dims.width, height: dims.height };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not read the image.",
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
  const [validInfo, setValidInfo] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function pickAndUpload(file: File) {
    setError("");
    setValidInfo("");
    setBusy(true);
    try {
      const v = await validateLogo(file);
      if (!v.ok) {
        setError(v.error);
        return;
      }
      if (v.width && v.height) {
        setValidInfo(`Validated: ${v.width}×${v.height}, ${(file.size / 1024).toFixed(0)} KB.`);
      } else {
        setValidInfo(`Validated: vector SVG, ${(file.size / 1024).toFixed(0)} KB.`);
      }
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/supplier/profile/logo", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Upload failed.");
        setValidInfo("");
        return;
      }
      setLogoUrl(data.logoUrl);
      setValidInfo("Saved. Showing across product cards, invoices, and order pages.");
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
        setValidInfo("");
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
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
          {logoUrl ? "Company logo" : "Add a company logo"}
        </div>
        <div className="muted-text" style={{ fontSize: 13, marginTop: 4 }}>
          Shown next to your name on product cards, on order pages, and on
          every invoice you issue. A good logo is what buyers remember.
        </div>

        <ul className="logo-specs">
          <li>
            <strong>Format:</strong> SVG (best), PNG, JPG, or WEBP
          </li>
          <li>
            <strong>Size:</strong> at least 256×256, at most 2000×2000 pixels
          </li>
          <li>
            <strong>Shape:</strong> square or close to square (4:5 to 5:4)
          </li>
          <li>
            <strong>File:</strong> under 2 MB
          </li>
          <li>
            <strong>Background:</strong> transparent (PNG / SVG) or a flat
            color that matches your brand
          </li>
        </ul>

        <input
          ref={fileInput}
          type="file"
          accept="image/svg+xml,image/png,image/jpeg,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pickAndUpload(f);
            e.target.value = "";
          }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
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
        {validInfo && !error && (
          <div className="alert alert-ok" style={{ marginTop: 10 }}>
            {validInfo}
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

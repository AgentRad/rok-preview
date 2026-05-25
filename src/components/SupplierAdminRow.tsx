"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type AdminSupplier = {
  id: string;
  name: string;
  contactEmail: string;
  certifications: string;
  logoUrl: string | null;
  website: string;
  description: string;
  status: string;
  rating: number;
  onTimeRate: number;
  productCount: number;
};

export default function SupplierAdminRow({ supplier }: { supplier: AdminSupplier }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState(supplier.name);
  const [contactEmail, setContactEmail] = useState(supplier.contactEmail);
  const [logoUrl, setLogoUrl] = useState(supplier.logoUrl || "");
  const [website, setWebsite] = useState(supplier.website);
  const [description, setDescription] = useState(supplier.description);
  const [certifications, setCertifications] = useState(supplier.certifications);
  const [status, setStatus] = useState(supplier.status);
  const [rating, setRating] = useState(supplier.rating);
  const [onTimeRate, setOnTimeRate] = useState(supplier.onTimeRate);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/suppliers/${supplier.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          contactEmail,
          logoUrl,
          website,
          description,
          certifications,
          status,
          rating,
          onTimeRate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not save.");
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function manageAs() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/acting-as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId: supplier.id }),
      });
      if (res.ok) {
        router.push("/supplier");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <tr>
        <td colSpan={6} style={{ background: "var(--bg)", padding: "16px 18px" }}>
          <form onSubmit={save}>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-row two">
              <div>
                <label>Company name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <label>Contact email</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="form-row two">
              <div>
                <label>Website</label>
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>
              <div>
                <label>Logo URL</label>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                />
              </div>
            </div>
            <div className="form-row">
              <label>Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="form-row">
              <label>Certifications</label>
              <input
                value={certifications}
                onChange={(e) => setCertifications(e.target.value)}
              />
            </div>
            <div className="form-row three">
              <div>
                <label>Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="PENDING">PENDING</option>
                  <option value="APPROVED">APPROVED (verified)</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                </select>
              </div>
              <div>
                <label>Rating (0-5)</label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={0.1}
                  value={rating}
                  onChange={(e) => setRating(Number(e.target.value))}
                />
              </div>
              <div>
                <label>On-time %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={onTimeRate}
                  onChange={(e) => setOnTimeRate(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="row-gap" style={{ marginTop: 8 }}>
              <button className="btn btn-primary btn-sm" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setEditing(false)}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {supplier.logoUrl && (
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 4,
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={supplier.logoUrl}
                alt={supplier.name}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </span>
          )}
          <div>
            <div style={{ fontWeight: 600 }}>{supplier.name}</div>
            {supplier.website && (
              <a
                href={supplier.website}
                target="_blank"
                rel="noopener noreferrer"
                className="muted-text"
                style={{ fontSize: 11.5, textDecoration: "none" }}
              >
                {supplier.website.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
        </div>
      </td>
      <td className="muted-text" style={{ fontSize: 12.5 }}>
        {supplier.contactEmail}
      </td>
      <td>
        <span className="badge badge-approved">{supplier.status}</span>
      </td>
      <td className="num">★ {supplier.rating.toFixed(1)}</td>
      <td className="num">{supplier.productCount}</td>
      <td>
        <div className="row-gap">
          <button
            type="button"
            className="link-btn"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <button
            type="button"
            className="link-btn"
            onClick={manageAs}
            disabled={busy}
          >
            Manage as
          </button>
        </div>
      </td>
    </tr>
  );
}

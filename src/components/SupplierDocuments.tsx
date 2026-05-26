"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type SupplierDocRow = {
  id: string;
  kind: string;
  filename: string;
  url: string;
  status: string;
  reviewNote: string;
  uploadedAt: string;
  reviewedAt: string | null;
};

const SLOTS: { kind: string; title: string; required: boolean; help: string }[] = [
  {
    kind: "SUPPLIER_AGREEMENT",
    title: "Supplier Agreement",
    required: true,
    help: "Countersigned PartsPort distribution agreement. Required.",
  },
  {
    kind: "W9",
    title: "W9",
    required: true,
    help: "IRS Form W9 for tax reporting on payouts. Required.",
  },
  {
    kind: "INSURANCE_COI",
    title: "Certificate of Insurance",
    required: true,
    help:
      "General liability + product liability COI naming PartsPort as additionally insured. Required.",
  },
  {
    kind: "OTHER",
    title: "Other",
    required: false,
    help:
      "Anything else relevant: W8 for non-US, banking confirmations, authorized-distributor letters, lien releases.",
  },
];

const STATUS_BADGE: Record<string, string> = {
  PENDING: "badge-pending",
  APPROVED: "badge-fulfilled",
  REJECTED: "badge-cancelled",
};

const ALLOWED_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={"badge " + (STATUS_BADGE[status] || "badge-pending")}>
      {status}
    </span>
  );
}

export default function SupplierDocuments({
  initialDocuments,
  blobConfigured,
}: {
  initialDocuments: SupplierDocRow[];
  blobConfigured: boolean;
}) {
  const router = useRouter();
  const [docs, setDocs] = useState<SupplierDocRow[]>(initialDocuments);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [errorByKind, setErrorByKind] = useState<Record<string, string>>({});
  const [urlByKind, setUrlByKind] = useState<Record<string, string>>({});
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function setError(kind: string, msg: string) {
    setErrorByKind((prev) => ({ ...prev, [kind]: msg }));
  }

  async function uploadFile(kind: string, file: File) {
    setError(kind, "");
    setBusyKind(kind);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      const res = await fetch("/api/supplier/documents", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(kind, data.error || "Upload failed.");
        return;
      }
      setDocs((prev) => [data.document, ...prev]);
      router.refresh();
    } finally {
      setBusyKind(null);
    }
  }

  async function submitUrl(kind: string) {
    const url = (urlByKind[kind] || "").trim();
    if (!url) {
      setError(kind, "Paste a URL or pick a file.");
      return;
    }
    setError(kind, "");
    setBusyKind(kind);
    try {
      const res = await fetch("/api/supplier/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(kind, data.error || "Could not save URL.");
        return;
      }
      setDocs((prev) => [data.document, ...prev]);
      setUrlByKind((prev) => ({ ...prev, [kind]: "" }));
      router.refresh();
    } finally {
      setBusyKind(null);
    }
  }

  async function removeDoc(id: string, kind: string) {
    setBusyKind(kind);
    setError(kind, "");
    try {
      const res = await fetch(`/api/supplier/documents/${id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(kind, data.error || "Could not remove.");
        return;
      }
      setDocs((prev) => prev.filter((d) => d.id !== id));
      router.refresh();
    } finally {
      setBusyKind(null);
    }
  }

  return (
    <div>
      <p
        className="muted-text"
        style={{ fontSize: 13, marginBottom: 14 }}
      >
        PartsPort verifies every supplier before going live. Upload these
        three documents to clear the legal gate. PDFs preferred; JPG, PNG,
        and WEBP also accepted.
      </p>
      {!blobConfigured && (
        <div
          className="alert alert-info"
          style={{ fontSize: 13, marginBottom: 14 }}
        >
          File uploads aren&rsquo;t enabled on this deployment yet. Paste a
          hosted URL for each document instead, or ask an admin to enable
          Vercel Blob.
        </div>
      )}
      <div className="doc-slot-grid">
        {SLOTS.map((slot) => {
          const slotDocs = docs.filter((d) => d.kind === slot.kind);
          const active = slotDocs[0];
          const isOther = slot.kind === "OTHER";
          const allowMore = isOther || !active;
          const busy = busyKind === slot.kind;
          return (
            <div
              key={slot.kind}
              className="doc-slot"
              data-kind={slot.kind}
            >
              <div className="doc-slot-head">
                <h3>
                  {slot.title}
                  {slot.required ? (
                    <span className="doc-slot-req"> · required</span>
                  ) : (
                    <span className="doc-slot-req optional"> · optional</span>
                  )}
                </h3>
                {active && <StatusBadge status={active.status} />}
              </div>
              <p className="doc-slot-help">{slot.help}</p>

              {slotDocs.length > 0 && (
                <ul className="doc-list">
                  {slotDocs.map((d) => (
                    <li key={d.id} className="doc-row">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="doc-link"
                        >
                          {d.filename || "Document"}
                        </a>
                        <div className="doc-meta">
                          Uploaded {new Date(d.uploadedAt).toLocaleDateString()}
                          {d.reviewedAt &&
                            ` · reviewed ${new Date(d.reviewedAt).toLocaleDateString()}`}
                        </div>
                        {d.status === "REJECTED" && d.reviewNote && (
                          <div className="doc-reject-note">
                            Admin note: {d.reviewNote}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <StatusBadge status={d.status} />
                        {d.status !== "APPROVED" && (
                          <button
                            type="button"
                            className="link-btn link-btn-danger"
                            onClick={() => removeDoc(d.id, slot.kind)}
                            disabled={busy}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {allowMore && (
                <div className="doc-upload-row">
                  <input
                    ref={(el) => {
                      fileRefs.current[slot.kind] = el;
                    }}
                    type="file"
                    accept={ALLOWED_ACCEPT}
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadFile(slot.kind, f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => fileRefs.current[slot.kind]?.click()}
                    disabled={busy || !blobConfigured}
                    title={
                      !blobConfigured
                        ? "Vercel Blob not configured. Use the URL field."
                        : undefined
                    }
                  >
                    {busy
                      ? "Uploading…"
                      : active
                        ? `Upload another ${slot.title.toLowerCase()}`
                        : `Upload ${slot.title.toLowerCase()}`}
                  </button>
                  <div className="doc-url-row">
                    <input
                      type="url"
                      placeholder="…or paste a hosted URL"
                      value={urlByKind[slot.kind] || ""}
                      onChange={(e) =>
                        setUrlByKind((prev) => ({
                          ...prev,
                          [slot.kind]: e.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => submitUrl(slot.kind)}
                      disabled={busy || !(urlByKind[slot.kind] || "").trim()}
                    >
                      Save URL
                    </button>
                  </div>
                </div>
              )}

              {errorByKind[slot.kind] && (
                <div className="alert alert-error" style={{ marginTop: 8 }}>
                  {errorByKind[slot.kind]}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

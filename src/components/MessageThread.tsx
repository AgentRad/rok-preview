"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type ThreadVisibility =
  | "PUBLIC"
  | "SUPPLIER_INTERNAL"
  | "BUYER_INTERNAL"
  | "ADMIN_ONLY";

export type ThreadViewerRole = "admin" | "buyer" | "supplier" | "none";

export type ThreadAttachment = {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  blobUrl: string;
};

export type ThreadMessage = {
  id: string;
  senderName: string;
  senderRole: string;
  body: string;
  createdAt: string;
  visibility: ThreadVisibility;
  attachments?: ThreadAttachment[];
};

type Props = {
  messages: ThreadMessage[];
  orderId?: string;
  quoteId?: string;
  directThreadId?: string;
  canPost: boolean;
  viewerRole?: ThreadViewerRole;
};

const MAX_ATTACHMENTS = 5;
const MAX_BYTES = 5 * 1024 * 1024;

function visibilityStyle(v: ThreadVisibility): React.CSSProperties {
  if (v === "SUPPLIER_INTERNAL") {
    return {
      borderLeft: "3px solid var(--amber-deep, #b45309)",
      paddingLeft: 10,
    };
  }
  if (v === "ADMIN_ONLY") {
    return { borderLeft: "3px solid #6b7280", paddingLeft: 10 };
  }
  if (v === "BUYER_INTERNAL") {
    return { borderLeft: "3px solid #6b7280", paddingLeft: 10 };
  }
  return {};
}

function visibilityLabel(v: ThreadVisibility): string | null {
  if (v === "SUPPLIER_INTERNAL") return "Internal, team only";
  if (v === "ADMIN_ONLY") return "Admin only";
  if (v === "BUYER_INTERNAL") return "Internal, buyer only";
  return null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function MessageThread({
  messages,
  orderId,
  quoteId,
  directThreadId,
  canPost,
  viewerRole = "none",
}: Props) {
  const isDirect = !!directThreadId;
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visibility, setVisibility] = useState<ThreadVisibility>("PUBLIC");
  const [pending, setPending] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // PLH-3w P3: abuse reporting. reportingId is the message whose report
  // form is open; reportedIds collects ids reported this session so the
  // control flips to "Reported" without a full reload.
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("Spam");
  const [reportDetail, setReportDetail] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const canReport = viewerRole !== "none";

  function openReport(id: string) {
    setReportingId(id);
    setReportReason("Spam");
    setReportDetail("");
    setReportError("");
  }

  async function submitReport(messageId: string) {
    setReportBusy(true);
    setReportError("");
    try {
      const res = await fetch(`/api/messages/${messageId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reportReason, detail: reportDetail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReportError(data.error || "Could not submit the report.");
        return;
      }
      setReportedIds((prev) => new Set(prev).add(messageId));
      setReportingId(null);
    } finally {
      setReportBusy(false);
    }
  }

  // PLH-3q P4: DM threads always send PUBLIC and never expose the visibility
  // toggle. Order/quote threads keep the per-role toggle behaviour.
  const showSupplierToggle =
    !isDirect && (viewerRole === "supplier" || viewerRole === "admin");
  const showAdminOption = !isDirect && viewerRole === "admin";

  // PLH-3s B3: accept a draft body from sibling components (the AI
  // "Draft reply" tile drops its output here via this CustomEvent).
  useEffect(() => {
    function onDraft(e: Event) {
      const ce = e as CustomEvent<{ text?: string }>;
      const t = ce.detail?.text;
      if (typeof t === "string") setBody(t);
    }
    window.addEventListener("partsport:set-thread-draft", onDraft as EventListener);
    return () =>
      window.removeEventListener(
        "partsport:set-thread-draft",
        onDraft as EventListener
      );
  }, []);

  // PLH-3p F4: clear the unread badge for this thread once it has been
  // opened. Fire-and-forget; the route 401/403s anonymous and unrelated
  // users by itself so it is safe to call regardless of viewerRole.
  useEffect(() => {
    if (viewerRole === "none") return;
    const threadKind = orderId
      ? "order"
      : quoteId
        ? "quote"
        : directThreadId
          ? "direct"
          : null;
    const threadId = orderId || quoteId || directThreadId;
    if (!threadKind || !threadId) return;
    fetch("/api/messages/mark-read", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadKind, threadId }),
    }).catch(() => {});
  }, [orderId, quoteId, directThreadId, viewerRole]);

  function onFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list) return;
    const incoming = Array.from(list);
    setError("");
    setPending((prev) => {
      const merged = [...prev];
      for (const f of incoming) {
        if (merged.length >= MAX_ATTACHMENTS) {
          setError(`Max ${MAX_ATTACHMENTS} files per message.`);
          break;
        }
        if (f.size > MAX_BYTES) {
          setError(`${f.name}: too large (max 5 MB).`);
          continue;
        }
        merged.push(f);
      }
      return merged;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePending(i: number) {
    setPending((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          quoteId,
          directThreadId,
          body,
          visibility: isDirect ? "PUBLIC" : visibility,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not send the message.");
        return;
      }
      const newId: string | undefined = data?.message?.id;
      if (newId && pending.length > 0) {
        const failures: string[] = [];
        for (const file of pending) {
          const fd = new FormData();
          fd.append("file", file);
          try {
            const up = await fetch(`/api/messages/${newId}/attachments`, {
              method: "POST",
              body: fd,
            });
            if (!up.ok) {
              const ud = await up.json().catch(() => ({}));
              failures.push(`${file.name}: ${ud.error || up.statusText}`);
            }
          } catch (err) {
            failures.push(`${file.name}: ${(err as Error).message}`);
          }
        }
        if (failures.length > 0) {
          setError(`Some files did not upload: ${failures.join("; ")}`);
        }
      }
      setBody("");
      setVisibility("PUBLIC");
      setPending([]);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="thread">
      {messages.length === 0 ? (
        <p className="muted-text" style={{ fontSize: 13.5, marginBottom: 14 }}>
          No messages yet. Posts here also reach the other party by email so
          nothing gets lost.
        </p>
      ) : (
        <ul className="thread-list">
          {messages.map((m) => {
            const label = visibilityLabel(m.visibility);
            const atts = m.attachments ?? [];
            return (
              <li
                key={m.id}
                className="thread-message"
                style={visibilityStyle(m.visibility)}
              >
                <div className="thread-meta">
                  <strong style={{ fontSize: 13.5 }}>{m.senderName}</strong>
                  <span
                    className="muted-text"
                    style={{ fontSize: 11.5 }}
                    suppressHydrationWarning
                  >
                    {m.senderRole.toLowerCase()} ·{" "}
                    {new Date(m.createdAt).toLocaleString()}
                  </span>
                  {label && (
                    <span
                      className="muted-text"
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        color:
                          m.visibility === "SUPPLIER_INTERNAL"
                            ? "var(--amber-deep, #b45309)"
                            : "#6b7280",
                      }}
                    >
                      {label}
                    </span>
                  )}
                </div>
                <div className="thread-body">{m.body}</div>
                {atts.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      marginTop: 8,
                    }}
                  >
                    {atts.map((a) => (
                      <a
                        key={a.id}
                        href={a.blobUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 10px",
                          borderRadius: 14,
                          background: "#f3f1eb",
                          color: "#1a1916",
                          fontSize: 12.5,
                          textDecoration: "none",
                          border: "1px solid #e2dfd7",
                        }}
                      >
                        <span aria-hidden>📎</span>
                        <span>{a.fileName}</span>
                        <span style={{ color: "#6f6d64" }}>
                          {formatBytes(a.fileSize)}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
                {canReport && (
                  <div style={{ marginTop: 6 }}>
                    {reportedIds.has(m.id) ? (
                      <span className="muted-text" style={{ fontSize: 11.5 }}>
                        Reported. An admin will review it.
                      </span>
                    ) : reportingId === m.id ? (
                      <div
                        style={{
                          marginTop: 6,
                          padding: 10,
                          border: "1px solid var(--line, #e2dfd7)",
                          borderRadius: 8,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          maxWidth: 360,
                        }}
                      >
                        <label style={{ fontSize: 12.5, display: "flex", flexDirection: "column", gap: 4 }}>
                          <span className="muted-text">Reason</span>
                          <select
                            value={reportReason}
                            onChange={(e) => setReportReason(e.target.value)}
                            disabled={reportBusy}
                          >
                            <option value="Spam">Spam</option>
                            <option value="Abusive">Abusive</option>
                            <option value="Off-topic">Off-topic</option>
                            <option value="Other">Other</option>
                          </select>
                        </label>
                        <textarea
                          value={reportDetail}
                          onChange={(e) => setReportDetail(e.target.value)}
                          placeholder="Add detail (optional)"
                          maxLength={500}
                          rows={2}
                          disabled={reportBusy}
                        />
                        {reportError && (
                          <div className="alert alert-error">{reportError}</div>
                        )}
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            disabled={reportBusy}
                            onClick={() => submitReport(m.id)}
                          >
                            {reportBusy ? "Submitting…" : "Submit report"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            disabled={reportBusy}
                            onClick={() => setReportingId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="link-button muted-text"
                        style={{
                          fontSize: 11.5,
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          textDecoration: "underline",
                        }}
                        onClick={() => openReport(m.id)}
                      >
                        Report
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canPost ? (
        <form onSubmit={send} className="thread-form">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a message"
            maxLength={4000}
            rows={4}
          />
          <div style={{ marginTop: 8, fontSize: 13 }}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.pdf,.docx,image/png,image/jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={onFilesPicked}
              disabled={busy || pending.length >= MAX_ATTACHMENTS}
            />
            <span className="muted-text" style={{ fontSize: 12, marginLeft: 8 }}>
              PNG, JPEG, PDF, DOCX. Up to {MAX_ATTACHMENTS} files, 5 MB each.
            </span>
          </div>
          {pending.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 6,
              }}
            >
              {pending.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 14,
                    background: "#f3f1eb",
                    fontSize: 12.5,
                    border: "1px solid #e2dfd7",
                  }}
                >
                  <span aria-hidden>📎</span>
                  <span>{f.name}</span>
                  <span style={{ color: "#6f6d64" }}>
                    {formatBytes(f.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePending(i)}
                    disabled={busy}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#6f6d64",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: 14,
                    }}
                    aria-label={`Remove ${f.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {(showSupplierToggle || showAdminOption) && (
            <div
              className="row-gap"
              style={{ marginTop: 8, fontSize: 13, alignItems: "center" }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="muted-text">Visible to</span>
                <select
                  value={visibility}
                  onChange={(e) =>
                    setVisibility(e.target.value as ThreadVisibility)
                  }
                  disabled={busy}
                >
                  <option value="PUBLIC">Everyone</option>
                  {showSupplierToggle && (
                    <option value="SUPPLIER_INTERNAL">My team only</option>
                  )}
                  {showAdminOption && (
                    <option value="ADMIN_ONLY">Admins only</option>
                  )}
                </select>
              </label>
            </div>
          )}
          {error && <div className="alert alert-error">{error}</div>}
          <div className="row-gap" style={{ marginTop: 8 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || !body.trim()}
            >
              {busy
                ? pending.length > 0
                  ? "Sending and uploading…"
                  : "Sending…"
                : "Send message"}
            </button>
          </div>
        </form>
      ) : (
        <p className="muted-text" style={{ fontSize: 13 }}>
          Sign in as the buyer, the supplier, or an admin to post in this
          thread.
        </p>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import MessageThread, {
  type ThreadMessage,
  type ThreadViewerRole,
} from "./MessageThread";

export type ThreadListItem = {
  id: string;
  subject: string;
  lastMessageAt: string;
  participants: { userId: string; name: string; role: string }[];
  lastSnippet: string;
  unread: number;
};

export type ThreadDetail = {
  id: string;
  subject: string;
  createdById: string;
  createdAt: string;
  lastMessageAt: string;
  participants: {
    userId: string;
    name: string;
    role: string;
    email: string;
    joinedAt: string;
    addedByUserId: string | null;
  }[];
};

export type CurrentUser = {
  id: string;
  name: string;
  role: string;
};

type Candidate = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type Props = {
  currentUser: CurrentUser;
  viewerRole: ThreadViewerRole;
  threads: ThreadListItem[];
  selectedThread: ThreadDetail | null;
  selectedMessages: ThreadMessage[];
};

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function roleLabel(role: string): string {
  if (role === "ADMIN") return "admin";
  if (role === "BUYER") return "buyer";
  if (role === "SUPPLIER") return "supplier";
  if (role === "MANUFACTURER") return "OEM";
  return role.toLowerCase();
}

export default function MessagesClient({
  currentUser,
  viewerRole,
  threads,
  selectedThread,
  selectedMessages,
}: Props) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const otherParticipants = useMemo(() => {
    if (!selectedThread) return [];
    return selectedThread.participants.filter(
      (p) => p.userId !== currentUser.id
    );
  }, [selectedThread, currentUser.id]);

  const joinNotices = useMemo(() => {
    if (!selectedThread) return [];
    return selectedThread.participants
      .filter((p) => p.addedByUserId && p.addedByUserId !== p.userId)
      .map((p) => ({
        key: `${p.userId}:${p.joinedAt}`,
        text: `Joined ${p.name}`,
        at: p.joinedAt,
      }));
  }, [selectedThread]);

  return (
    <div className="messages-shell">
      <div className="messages-header">
        <h1 className="page-title" style={{ margin: 0 }}>
          Messages
        </h1>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setShowNew(true)}
        >
          New conversation
        </button>
      </div>

      <div className="messages-grid">
        <aside className="messages-list" aria-label="Conversations">
          {threads.length === 0 ? (
            <p className="muted-text" style={{ fontSize: 13.5, padding: 16 }}>
              No conversations yet. Start one from any supplier, buyer, or
              admin profile.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {threads.map((t) => {
                const others = t.participants.filter(
                  (p) => p.userId !== currentUser.id
                );
                const isSelected = selectedThread?.id === t.id;
                return (
                  <li key={t.id}>
                    <Link
                      href={`/messages/${t.id}`}
                      className="messages-list-item"
                      data-selected={isSelected ? "true" : undefined}
                      style={{
                        display: "block",
                        padding: "12px 14px",
                        borderBottom: "1px solid var(--line)",
                        textDecoration: "none",
                        color: "inherit",
                        background: isSelected
                          ? "var(--surface-strong, #f6f4ee)"
                          : "transparent",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: 2,
                        }}
                      >
                        {t.unread > 0 && (
                          <span
                            aria-label={`${t.unread} unread`}
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              background: "var(--accent, #b45309)",
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <strong
                          style={{
                            fontSize: 13.5,
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {t.subject}
                        </strong>
                        <span
                          className="muted-text"
                          style={{ fontSize: 11.5, flexShrink: 0 }}
                          suppressHydrationWarning
                        >
                          {formatRelative(t.lastMessageAt)}
                        </span>
                      </div>
                      <div
                        className="muted-text"
                        style={{ fontSize: 12, marginBottom: 2 }}
                      >
                        {others.map((o) => o.name).join(", ") || "Just you"}
                      </div>
                      {t.lastSnippet && (
                        <div
                          style={{
                            fontSize: 12.5,
                            color: "#6f6d64",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {t.lastSnippet}
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="messages-detail" aria-label="Conversation">
          {!selectedThread ? (
            <div style={{ padding: 24 }}>
              <p className="muted-text" style={{ fontSize: 14 }}>
                {threads.length === 0
                  ? "No conversations yet. Start one from any supplier, buyer, or admin profile."
                  : "Pick a conversation on the left to read it."}
              </p>
            </div>
          ) : (
            <div style={{ padding: "16px 20px" }}>
              <div style={{ marginBottom: 14 }}>
                <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>
                  {selectedThread.subject}
                </h2>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {selectedThread.participants.map((p) => (
                    <span
                      key={p.userId}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "3px 10px",
                        borderRadius: 14,
                        background: "#f3f1eb",
                        border: "1px solid #e2dfd7",
                        fontSize: 12,
                      }}
                    >
                      <span>{p.name}</span>
                      <span className="muted-text" style={{ fontSize: 11 }}>
                        {roleLabel(p.role)}
                      </span>
                    </span>
                  ))}
                  {selectedThread.participants.length < 10 && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowAdd(true)}
                      style={{ marginLeft: 4 }}
                    >
                      Add people
                    </button>
                  )}
                </div>
              </div>

              {joinNotices.length > 0 && (
                <ul
                  style={{
                    listStyle: "none",
                    margin: "0 0 14px",
                    padding: 0,
                  }}
                >
                  {joinNotices.map((n) => (
                    <li
                      key={n.key}
                      className="muted-text"
                      style={{
                        fontSize: 12,
                        padding: "4px 0",
                        textAlign: "center",
                      }}
                      suppressHydrationWarning
                    >
                      {n.text} · {new Date(n.at).toLocaleString()}
                    </li>
                  ))}
                </ul>
              )}

              <MessageThread
                messages={selectedMessages}
                directThreadId={selectedThread.id}
                canPost={true}
                viewerRole={viewerRole}
              />
            </div>
          )}
        </section>
      </div>

      {showNew && (
        <NewConversationModal
          currentUserId={currentUser.id}
          onClose={() => setShowNew(false)}
          onCreated={(threadId) => {
            setShowNew(false);
            router.push(`/messages/${threadId}`);
            router.refresh();
          }}
        />
      )}

      {showAdd && selectedThread && (
        <AddPeopleModal
          threadId={selectedThread.id}
          existingUserIds={selectedThread.participants.map((p) => p.userId)}
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function useRecipientSearch(excludeIds: string[]) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/dm/can-dm?q=${encodeURIComponent(q.trim())}`
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data?.users)) {
          const filtered: Candidate[] = data.users.filter(
            (u: Candidate) => !excludeIds.includes(u.id)
          );
          setResults(filtered);
        } else {
          setResults([]);
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [q, excludeIds]);

  return { q, setQ, results, searching };
}

function NewConversationModal({
  currentUserId,
  onClose,
  onCreated,
}: {
  currentUserId: string;
  onClose: () => void;
  onCreated: (threadId: string) => void;
}) {
  const [picked, setPicked] = useState<Candidate[]>([]);
  const [subject, setSubject] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const excludeIds = useMemo(
    () => [currentUserId, ...picked.map((p) => p.id)],
    [currentUserId, picked]
  );
  const { q, setQ, results, searching } = useRecipientSearch(excludeIds);

  function pick(c: Candidate) {
    setPicked((prev) => {
      if (prev.length >= 9 || prev.some((p) => p.id === c.id)) return prev;
      return [...prev, c];
    });
    setQ("");
  }

  function unpick(id: string) {
    setPicked((prev) => prev.filter((p) => p.id !== id));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }
    if (picked.length === 0) {
      setError("Pick at least one recipient.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/dm/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          recipientUserIds: picked.map((p) => p.id),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not start the conversation.");
        setBusy(false);
        return;
      }
      const threadId: string = data.thread?.id;
      if (firstMessage.trim() && threadId) {
        await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            directThreadId: threadId,
            body: firstMessage.trim(),
            visibility: "PUBLIC",
          }),
        }).catch(() => {});
      }
      onCreated(threadId);
    } catch (err) {
      setError((err as Error).message || "Could not start the conversation.");
      setBusy(false);
    }
  }

  return (
    <ModalShell title="New conversation" onClose={onClose}>
      <form onSubmit={submit}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
          Recipients (up to 9)
        </label>
        {picked.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              margin: "6px 0",
            }}
          >
            {picked.map((p) => (
              <span
                key={p.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 10px",
                  borderRadius: 14,
                  background: "#f3f1eb",
                  border: "1px solid #e2dfd7",
                  fontSize: 12,
                }}
              >
                {p.name}
                <button
                  type="button"
                  onClick={() => unpick(p.id)}
                  aria-label={`Remove ${p.name}`}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#6f6d64",
                    padding: 0,
                    fontSize: 14,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or email"
          disabled={busy || picked.length >= 9}
          style={{ width: "100%" }}
        />
        {q.trim().length >= 2 && (
          <ul
            style={{
              listStyle: "none",
              margin: "6px 0 0",
              padding: 0,
              maxHeight: 180,
              overflowY: "auto",
              border: "1px solid var(--line)",
              borderRadius: 6,
            }}
          >
            {searching && (
              <li
                className="muted-text"
                style={{ padding: "8px 10px", fontSize: 12.5 }}
              >
                Searching…
              </li>
            )}
            {!searching && results.length === 0 && (
              <li
                className="muted-text"
                style={{ padding: "8px 10px", fontSize: 12.5 }}
              >
                No matches.
              </li>
            )}
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pick(c)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  <strong>{c.name}</strong>{" "}
                  <span className="muted-text" style={{ fontSize: 12 }}>
                    {c.email} · {roleLabel(c.role)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <label
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            marginTop: 14,
          }}
        >
          Subject
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={256}
          required
          disabled={busy}
          style={{ width: "100%" }}
        />

        <label
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            marginTop: 14,
          }}
        >
          First message (optional)
        </label>
        <textarea
          value={firstMessage}
          onChange={(e) => setFirstMessage(e.target.value)}
          rows={4}
          maxLength={4000}
          disabled={busy}
          style={{ width: "100%" }}
        />

        {error && (
          <div className="alert alert-error" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}
        <div
          className="row-gap"
          style={{ marginTop: 14, justifyContent: "flex-end" }}
        >
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={busy}
          >
            {busy ? "Starting…" : "Start conversation"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function AddPeopleModal({
  threadId,
  existingUserIds,
  onClose,
  onAdded,
}: {
  threadId: string;
  existingUserIds: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [picked, setPicked] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const slotsLeft = Math.max(0, 10 - existingUserIds.length);

  const excludeIds = useMemo(
    () => [...existingUserIds, ...picked.map((p) => p.id)],
    [existingUserIds, picked]
  );
  const { q, setQ, results, searching } = useRecipientSearch(excludeIds);

  function pick(c: Candidate) {
    setPicked((prev) => {
      if (prev.length >= slotsLeft || prev.some((p) => p.id === c.id))
        return prev;
      return [...prev, c];
    });
    setQ("");
  }

  function unpick(id: string) {
    setPicked((prev) => prev.filter((p) => p.id !== id));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (picked.length === 0) {
      setError("Pick at least one person to add.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/dm/threads/${threadId}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: picked.map((p) => p.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not add people.");
        setBusy(false);
        return;
      }
      onAdded();
    } catch (err) {
      setError((err as Error).message || "Could not add people.");
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Add people" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted-text" style={{ fontSize: 12.5, marginTop: 0 }}>
          {slotsLeft} of 10 seats left in this thread.
        </p>
        {picked.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              margin: "6px 0",
            }}
          >
            {picked.map((p) => (
              <span
                key={p.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 10px",
                  borderRadius: 14,
                  background: "#f3f1eb",
                  border: "1px solid #e2dfd7",
                  fontSize: 12,
                }}
              >
                {p.name}
                <button
                  type="button"
                  onClick={() => unpick(p.id)}
                  aria-label={`Remove ${p.name}`}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#6f6d64",
                    padding: 0,
                    fontSize: 14,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or email"
          disabled={busy || picked.length >= slotsLeft}
          style={{ width: "100%" }}
        />
        {q.trim().length >= 2 && (
          <ul
            style={{
              listStyle: "none",
              margin: "6px 0 0",
              padding: 0,
              maxHeight: 180,
              overflowY: "auto",
              border: "1px solid var(--line)",
              borderRadius: 6,
            }}
          >
            {searching && (
              <li
                className="muted-text"
                style={{ padding: "8px 10px", fontSize: 12.5 }}
              >
                Searching…
              </li>
            )}
            {!searching && results.length === 0 && (
              <li
                className="muted-text"
                style={{ padding: "8px 10px", fontSize: 12.5 }}
              >
                No matches.
              </li>
            )}
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => pick(c)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  <strong>{c.name}</strong>{" "}
                  <span className="muted-text" style={{ fontSize: 12 }}>
                    {c.email} · {roleLabel(c.role)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <div className="alert alert-error" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}
        <div
          className="row-gap"
          style={{ marginTop: 14, justifyContent: "flex-end" }}
        >
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={busy}
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 18, 14, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--surface, #fff)",
          borderRadius: 8,
          maxWidth: 480,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 20,
          boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 22,
              lineHeight: 1,
              padding: 4,
              color: "#6f6d64",
            }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

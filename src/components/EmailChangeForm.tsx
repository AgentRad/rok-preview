"use client";

import { useState } from "react";

/**
 * Two-step email-change UI. Step 1: user types the new address + their
 * current password and submits. Step 2: server emails a confirmation
 * link to the new address; nothing changes until the user clicks it.
 * The old address gets a heads-up at step 1 and a confirmation at swap.
 */
export default function EmailChangeForm({
  currentEmail,
}: {
  currentEmail: string;
}) {
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk(null);
    try {
      const res = await fetch("/api/account/email-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not start the email change.");
        return;
      }
      setOk(
        `Sent a confirmation link to ${data.sentTo}. Click it within ${data.expiresHours} hours to finish the switch. Your current email got a heads-up too.`
      );
      setNewEmail("");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="muted-text" style={{ fontSize: 13, lineHeight: 1.55 }}>
        Sign-in email today: <strong>{currentEmail}</strong>. We email a
        confirmation link to the new address; the swap happens when you
        click it. Both addresses get notified for security.
      </p>
      <div className="form-row two" style={{ marginTop: 10 }}>
        <div>
          <label>New email</label>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="work@example.com"
            required
          />
        </div>
        <div>
          <label>Current password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
      </div>
      {error && (
        <div className="alert alert-error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
      {ok && (
        <div className="alert alert-ok" style={{ marginTop: 10 }}>
          {ok}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? "Sending…" : "Send confirmation"}
        </button>
      </div>
    </form>
  );
}

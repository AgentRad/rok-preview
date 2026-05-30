"use client";

import { useState } from "react";

export default function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("The two new passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not change the password.");
        return;
      }
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="alert alert-ok">
        Password updated. The next time you sign in, use the new password.
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-row">
        <label htmlFor="cp-current">Current password</label>
        <input
          id="cp-current"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>
      <div className="form-row two">
        <div>
          <label htmlFor="cp-new">New password</label>
          <input
            id="cp-new"
            type="password"
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="cp-confirm">Confirm new password</label>
          <input
            id="cp-confirm"
            type="password"
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
      </div>
      <button className="btn btn-primary btn-sm" disabled={busy}>
        {busy ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}

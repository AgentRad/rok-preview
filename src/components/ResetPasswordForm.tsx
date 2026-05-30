"use client";

import { useState } from "react";
import Link from "next/link";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not reset the password.");
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>Reset password</h1>
          <p className="sub">This link is missing a reset token.</p>
          <Link className="btn btn-primary btn-block" href="/forgot-password">
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Set a new password</h1>
        <p className="sub">
          Choose a password of at least 8 characters. After you reset, you can
          sign in with the new password.
        </p>
        {done ? (
          <>
            <div className="alert alert-ok">
              Your password has been reset. You can now sign in.
            </div>
            <Link className="btn btn-primary btn-block" href="/login">
              Sign in
            </Link>
          </>
        ) : (
          <>
            {error && <div className="alert alert-error">{error}</div>}
            <form onSubmit={submit}>
              <div className="form-row">
                <label htmlFor="pw">New password</label>
                <input
                  id="pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="form-row">
                <label htmlFor="pw2">Confirm password</label>
                <input
                  id="pw2"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              <button className="btn btn-primary btn-block" disabled={busy}>
                {busy ? "Resetting…" : "Reset password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

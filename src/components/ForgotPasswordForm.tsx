"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        setError("Could not submit the request. Please try again.");
        return;
      }
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Reset password</h1>
        <p className="sub">
          Enter the email you signed up with and we will send a link to set a
          new password.
        </p>
        {sent ? (
          <div className="alert alert-ok">
            If an account exists for that email, a reset link is on the way.
            Check your inbox.
          </div>
        ) : (
          <>
            {error && <div className="alert alert-error">{error}</div>}
            <form onSubmit={submit}>
              <div className="form-row">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <button className="btn btn-primary btn-block" disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </button>
            </form>
          </>
        )}
        <div className="auth-alt">
          <Link href="/login">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}

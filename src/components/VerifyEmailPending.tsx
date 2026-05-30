"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * PLH-1 commit 2: post-register holding page. Registration no longer
 * drops a session cookie; the user must click the link in the
 * verification email first. This page tells them what happened and
 * offers a resend.
 */
export default function VerifyEmailPending({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function resend() {
    setBusy(true);
    setMsg("");
    setErr("");
    // The /api/auth/resend-verification endpoint requires a session; for
    // an un-verified, un-signed-in user we just point them at the login
    // page where the verify-pending banner will surface the resend.
    // Until that's wired, fall back to forgot-password as the recovery
    // path. We POST anyway in case the user is already signed in (rare).
    const res = await fetch("/api/auth/resend-verification", {
      method: "POST",
    });
    setBusy(false);
    if (res.ok) {
      setMsg("Verification email sent. Please check your inbox.");
    } else if (res.status === 401) {
      setErr(
        "Please sign in once verified, or use Forgot password if you can no longer access the inbox."
      );
    } else {
      const data = await res.json().catch(() => ({}));
      setErr(data.error || "Could not resend right now. Please try again.");
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Verify your email</h1>
        <p className="sub">
          Check your email{email ? ` (${email})` : ""} to verify your account
          before signing in. The verification link expires in 24 hours.
        </p>
        {msg && <div className="alert alert-success">{msg}</div>}
        {err && <div className="alert alert-error">{err}</div>}
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={resend}
          disabled={busy}
        >
          {busy ? "Sending..." : "Resend verification email"}
        </button>
        <div className="auth-alt">
          Already verified? <Link href="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";

/**
 * PLH-1 commit 2: session-fixation interstitial. When a GET to one of
 * the auth state-mutating routes (verify, recover, email-change/confirm)
 * arrives with an existing session for a different userId, the route
 * redirects here. The user has to click Continue, which POSTs to the
 * same route to proceed.
 */
export default function ConfirmActionForm({
  token,
  postUrl,
  title,
  body,
  label,
}: {
  token: string;
  postUrl: string;
  title: string;
  body: string;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch(`${postUrl}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      redirect: "follow",
    });
    // The route returns a 303 redirect on success. fetch with
    // redirect:follow follows it; the final response is the landing
    // page. Navigate there so the cookie change applies.
    if (res.redirected) {
      window.location.href = res.url;
      return;
    }
    if (res.ok) {
      // Fallback when the server returns 200 instead of a redirect.
      window.location.href = "/account";
      return;
    }
    setBusy(false);
    setErr("This link is no longer valid. Please request a fresh email.");
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>{title}</h1>
        <p className="sub">{body}</p>
        {err && <div className="alert alert-error">{err}</div>}
        <form onSubmit={submit}>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Working..." : label}
          </button>
        </form>
      </div>
    </div>
  );
}

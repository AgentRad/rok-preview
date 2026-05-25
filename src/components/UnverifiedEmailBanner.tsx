"use client";

import { useState } from "react";

/**
 * Site-wide banner shown to signed-in users whose email hasn't been
 * verified yet. Rendered by SiteHeader for any authenticated user with
 * `emailVerified == null`. Hidden once they click the verification link.
 */
export default function UnverifiedEmailBanner({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );
  const [hidden, setHidden] = useState(false);

  async function resend() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({
          kind: "err",
          text: data.error || "Could not resend the verification email.",
        });
        return;
      }
      setMsg({
        kind: "ok",
        text: data.alreadyVerified
          ? "Your email is already verified. Refresh the page."
          : `New verification link sent to ${email}.`,
      });
    } finally {
      setBusy(false);
    }
  }

  if (hidden) return null;
  return (
    <div className="verify-banner" role="status">
      <div className="verify-banner-inner">
        <div className="verify-banner-text">
          <strong>Verify your email.</strong> We sent a link to{" "}
          <span className="verify-email">{email}</span>. Some actions (placing
          orders, publishing listings, responding to RFQs) are locked until you
          confirm the address.
          {msg && (
            <span
              className={
                msg.kind === "ok"
                  ? "verify-banner-ok"
                  : "verify-banner-err"
              }
            >
              {" "}
              {msg.text}
            </span>
          )}
        </div>
        <div className="verify-banner-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={resend}
            disabled={busy}
          >
            {busy ? "Sending…" : "Resend"}
          </button>
          <button
            type="button"
            className="link-btn"
            onClick={() => setHidden(true)}
            aria-label="Dismiss for this session"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

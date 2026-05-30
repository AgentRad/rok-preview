"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const COOKIE_NAME = "pp_consent";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function readConsent(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
}

function writeConsent(value: "accepted" | "dismissed") {
  document.cookie = `${COOKIE_NAME}=${value}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
}

/**
 * First-visit consent banner. Functional cookies (session, CSRF, cart) are
 * still set without consent because the site needs them to operate; this
 * banner exists for ePrivacy + CCPA transparency, not blocking. Dismissal
 * is recorded in the pp_consent cookie so the banner doesn't reappear.
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const existing = readConsent();
    if (!existing) {
      // Show after a short delay so the page paint isn't shoved.
      const id = setTimeout(() => setVisible(true), 400);
      return () => clearTimeout(id);
    }
  }, []);

  function close(action: "accepted" | "dismissed") {
    writeConsent(action);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie notice"
      aria-live="polite"
      className="cookie-consent"
    >
      <div className="cookie-consent-body">
        <strong>Cookies.</strong> PartsPort uses functional cookies to keep
        you signed in, remember your cart, and protect against forged
        requests. We do not use third-party advertising cookies. We use
        cookieless first-party analytics to understand site performance.
        See the{" "}
        <Link href="/legal/privacy#cookies">Privacy Policy</Link> for the
        full list. Procurement teams: see the{" "}
        <Link href="/legal/dpa">Data Processing Addendum</Link>.
      </div>
      <div className="cookie-consent-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => close("accepted")}
        >
          OK
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => close("dismissed")}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

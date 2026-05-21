"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "partsport_demo_guide_v1";

export default function DemoGuide() {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(KEY)) setOpen(true);
    setReady(true);
  }, []);

  function close() {
    setOpen(false);
    localStorage.setItem(KEY, "1");
  }

  if (!ready) return null;

  if (!open) {
    return (
      <button
        className="demo-launch"
        onClick={() => setOpen(true)}
        aria-label="Open the demo guide"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5 9.8 12.2 3.5 10l6.3-1.7z" />
        </svg>
        Demo guide
      </button>
    );
  }

  return (
    <div className="dg-overlay" onClick={close}>
      <div
        className="demo-guide"
        role="dialog"
        aria-modal="true"
        aria-label="Demo guide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dg-head">
          <strong>Exploring the PartsPort prototype</strong>
          <button className="dg-close" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        <p className="dg-intro">
          A live demo of the industrial parts marketplace. There are three
          sides to try:
        </p>
        <ol className="dg-steps">
          <li>
            <span className="dg-num">1</span>
            <div>
              <strong>Shop as a buyer</strong>
              <span>
                Search for a part (try &ldquo;protective relay&rdquo; or
                &ldquo;backup generator&rdquo;), open it, and check out — or
                request a quote on big-ticket gear. No login needed.
              </span>
            </div>
          </li>
          <li>
            <span className="dg-num">2</span>
            <div>
              <strong>The supplier side</strong>
              <span>
                Distributors manage listings, price incoming quote requests,
                and fulfill orders.
              </span>
            </div>
          </li>
          <li>
            <span className="dg-num">3</span>
            <div>
              <strong>The manufacturer &amp; admin side</strong>
              <span>
                OEMs get demand intelligence and a branded storefront; admins
                oversee metrics, approvals, orders, and quotes.
              </span>
            </div>
          </li>
        </ol>
        <div className="dg-creds">
          <div className="dg-creds-h">
            Demo buyer sign-in · password <code>demo1234</code>
          </div>
          <div>Email — <code>buyer@partsport.example</code></div>
          <div style={{ marginTop: 4, color: "var(--steel-light)" }}>
            Supplier, manufacturer &amp; admin logins available from the
            PartsPort team.
          </div>
        </div>
        <div className="dg-actions">
          <Link href="/catalog" className="btn btn-primary btn-sm" onClick={close}>
            Start with the catalog
          </Link>
          <button className="btn btn-ghost btn-sm" onClick={close}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// PLH-3u P3: dismissible setup nudge on /account. Shown when the buyer has
// no saved address. Dismissal persists in localStorage so a returning buyer
// who chose to ignore it does not see it on every load.
export default function AccountSetupCard({
  hasAddress,
}: {
  hasAddress: boolean;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setHydrated(true);
    setDismissed(localStorage.getItem("plh3u-account-setup-dismissed") === "1");
  }, []);

  if (!hydrated || dismissed || hasAddress) return null;

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-head">
        <h2 style={{ fontSize: 16 }}>Get set up</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            localStorage.setItem("plh3u-account-setup-dismissed", "1");
            setDismissed(true);
          }}
          aria-label="Dismiss setup card"
        >
          Dismiss
        </button>
      </div>
      <div className="card-body" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link className="btn btn-primary btn-sm" href="/settings#addresses">
          Save a delivery address
        </Link>
        <Link className="btn btn-ghost btn-sm" href="/settings#notifications">
          Set notification preferences
        </Link>
      </div>
    </div>
  );
}

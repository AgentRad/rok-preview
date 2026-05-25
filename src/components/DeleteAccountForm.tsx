"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Two-step account deletion. The first click swaps in a confirmation
 * form (password + a typed CONFIRM-the-word check); the second click
 * fires POST /api/account/delete. After success the user is signed out
 * and redirected to /login.
 */
export default function DeleteAccountForm() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmWord, setConfirmWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (confirmWord.trim().toUpperCase() !== "DELETE") {
      setError("Type DELETE in the confirmation field to proceed.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not delete the account.");
        return;
      }
      router.push("/login?deleted=1");
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <div>
        <p className="muted-text" style={{ fontSize: 13, lineHeight: 1.55 }}>
          You can close your account at any time. The account is hidden
          immediately and you get a 30-day recovery window via email. Order
          and invoice records are kept for tax/accounting compliance per the
          Privacy Policy.
        </p>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 10, color: "#b4431f", borderColor: "#e8c6b1" }}
          onClick={() => setConfirming(true)}
        >
          Delete my account
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={submit}>
      <div className="alert alert-info" style={{ marginBottom: 12 }}>
        <strong>Heads up.</strong> You&rsquo;ll be signed out. The recovery
        link emailed to your address is the only way back in for the next
        30 days. After that, PII is anonymized.
      </div>
      <div className="form-row two">
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
        <div>
          <label>
            Type <code>DELETE</code> to confirm
          </label>
          <input
            type="text"
            value={confirmWord}
            onChange={(e) => setConfirmWord(e.target.value)}
            placeholder="DELETE"
            required
          />
        </div>
      </div>
      {error && (
        <div className="alert alert-error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
      <div className="row-gap" style={{ marginTop: 12 }}>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={busy}
          style={{ background: "#b4431f", borderColor: "#b4431f" }}
        >
          {busy ? "Deleting…" : "Confirm deletion"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setConfirming(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

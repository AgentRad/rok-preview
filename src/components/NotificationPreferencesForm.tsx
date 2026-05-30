"use client";

import { useState } from "react";

type Prefs = {
  notifyOrderEmails: boolean;
  notifyMarketingEmails: boolean;
  notifyProductUpdates: boolean;
};

/**
 * PLH-2 Phase 4d (D1): three toggles for non-transactional email
 * categories. Transactional mail (auth, money movement, order state)
 * always sends regardless of these flags; the helper text says so.
 */
export default function NotificationPreferencesForm({
  initial,
}: {
  initial: Prefs;
}) {
  const [prefs, setPrefs] = useState<Prefs>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function patch(next: Partial<Prefs>) {
    setBusy(true);
    setError("");
    setSaved(false);
    const optimistic = { ...prefs, ...next };
    setPrefs(optimistic);
    try {
      const res = await fetch("/api/account/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Roll back on failure so the UI matches the server.
        setPrefs(prefs);
        setError(data.error || "Could not save.");
        return;
      }
      if (data.preferences) {
        setPrefs(data.preferences);
      }
      setSaved(true);
    } catch {
      setPrefs(prefs);
      setError("Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const row = (
    key: keyof Prefs,
    label: string,
    helper: string
  ) => (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "10px 0",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={prefs[key]}
        disabled={busy}
        onChange={(e) => patch({ [key]: e.target.checked } as Partial<Prefs>)}
        style={{ marginTop: 3 }}
      />
      <span style={{ flex: 1 }}>
        <span style={{ fontWeight: 600, display: "block" }}>{label}</span>
        <span className="muted-text" style={{ fontSize: 13 }}>
          {helper}
        </span>
      </span>
    </label>
  );

  return (
    <div>
      {row(
        "notifyOrderEmails",
        "Order updates",
        "Optional order digests and shipping reminders. Critical receipts (paid, shipped, delivered, refunded) always send."
      )}
      {row(
        "notifyMarketingEmails",
        "Marketing announcements",
        "Occasional news about PartsPort, promotions, and new supplier launches."
      )}
      {row(
        "notifyProductUpdates",
        "Product updates",
        "Heads-up when we ship new features that affect your account."
      )}
      <p className="muted-text" style={{ fontSize: 12, marginTop: 10 }}>
        Account, security, payment, and order-status emails are required and
        always send.
      </p>
      {error && (
        <div className="alert alert-error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
      {saved && !error && (
        <div className="muted-text" style={{ fontSize: 12, marginTop: 8 }}>
          Saved.
        </div>
      )}
    </div>
  );
}

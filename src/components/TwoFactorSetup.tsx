"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type EnrollResult = {
  secret: string;
  otpauthUrl: string;
};

export default function TwoFactorSetup({
  enabled,
  enabledAt,
}: {
  enabled: boolean;
  enabledAt: string | null;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enroll, setEnroll] = useState<EnrollResult | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showDisable, setShowDisable] = useState(false);

  async function startEnroll(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/2fa/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not start enrollment.");
        return;
      }
      setEnroll({ secret: data.secret, otpauthUrl: data.otpauthUrl });
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not verify the code.");
        return;
      }
      setBackupCodes(data.backupCodes || []);
      setEnroll(null);
      setCode("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not disable.");
        return;
      }
      setPassword("");
      setShowDisable(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (backupCodes) {
    return (
      <div>
        <div className="alert alert-ok" style={{ marginBottom: 14 }}>
          Two-factor authentication is now on. Save these backup codes
          somewhere safe; each one works once if you lose your authenticator
          and they are not shown again.
        </div>
        <div
          style={{
            background: "var(--bg)",
            border: "1px solid var(--line-strong)",
            borderRadius: "var(--radius-sm)",
            padding: 16,
            fontFamily: "var(--mono)",
            fontSize: 14,
            lineHeight: 1.9,
            columnCount: 2,
            columnGap: 24,
          }}
        >
          {backupCodes.map((c) => (
            <div key={c}>{c}</div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 14 }}
          onClick={() => setBackupCodes(null)}
        >
          Done
        </button>
      </div>
    );
  }

  if (enabled) {
    return (
      <div>
        <p style={{ marginBottom: 12, fontSize: 14 }}>
          Two-factor authentication is <strong>on</strong>
          {enabledAt
            ? ` (enabled ${new Date(enabledAt).toLocaleDateString()})`
            : ""}
          . You will be asked for a code after your password on every sign in.
        </p>
        {showDisable ? (
          <form onSubmit={disable}>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-row">
              <label htmlFor="d-pw">Current password (to confirm)</label>
              <input
                id="d-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="row-gap">
              <button className="btn btn-dark btn-sm" disabled={busy}>
                {busy ? "Disabling…" : "Disable 2FA"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowDisable(false);
                  setError("");
                  setPassword("");
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowDisable(true)}
          >
            Turn off 2FA
          </button>
        )}
      </div>
    );
  }

  if (enroll) {
    return (
      <div>
        <p style={{ fontSize: 14, marginBottom: 12 }}>
          Open your authenticator app (Google Authenticator, Authy, 1Password,
          etc.) and scan this otpauth URL, or paste the secret manually. Then
          enter the 6-digit code it displays.
        </p>
        <div
          style={{
            background: "var(--bg)",
            border: "1px solid var(--line-strong)",
            borderRadius: "var(--radius-sm)",
            padding: 14,
            marginBottom: 16,
          }}
        >
          <div className="invoice-meta-label">Authenticator URL</div>
          <code
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              wordBreak: "break-all",
              display: "block",
              marginTop: 6,
            }}
          >
            {enroll.otpauthUrl}
          </code>
          <div className="invoice-meta-label" style={{ marginTop: 12 }}>
            Or paste this secret
          </div>
          <code
            style={{
              fontFamily: "var(--mono)",
              fontSize: 14,
              letterSpacing: ".05em",
              display: "block",
              marginTop: 4,
            }}
          >
            {enroll.secret.replace(/(.{4})/g, "$1 ").trim()}
          </code>
        </div>
        <form onSubmit={confirmCode}>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-row">
            <label htmlFor="v-code">Code from authenticator</label>
            <input
              id="v-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              required
              autoFocus
            />
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? "Verifying…" : "Verify and enable"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <form onSubmit={startEnroll}>
      <p style={{ fontSize: 14, marginBottom: 12 }}>
        Two-factor authentication is <strong>off</strong>. Strongly recommended
        for owner and admin roles. Uses time-based codes (TOTP), compatible
        with any standard authenticator app.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-row">
        <label htmlFor="e-pw">Current password (to start)</label>
        <input
          id="e-pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <button className="btn btn-primary btn-sm" disabled={busy}>
        {busy ? "Starting…" : "Set up 2FA"}
      </button>
    </form>
  );
}

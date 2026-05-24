"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const HOME: Record<string, string> = {
  ADMIN: "/admin",
  SUPPLIER: "/supplier",
  BUYER: "/account",
  MANUFACTURER: "/oem",
};

type Step = "password" | "twofa";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState("");
  const [step, setStep] = useState<Step>("password");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok && !data.requires2FA) {
        setError(data.error || "Sign in failed.");
        return;
      }
      if (data.requires2FA) {
        setTicket(data.ticket);
        setStep("twofa");
        return;
      }
      router.push(HOME[data.role] || "/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submit2fa(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Verification failed.");
        return;
      }
      router.push(HOME[data.role] || "/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Sign in</h1>
        <p className="sub">Welcome back to PartsPort.</p>
        {error && <div className="alert alert-error">{error}</div>}
        {step === "password" ? (
          <>
            <form onSubmit={submitPassword}>
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
              <div className="form-row">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <button className="btn btn-primary btn-block" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
            <div className="auth-alt" style={{ marginTop: 14 }}>
              <Link href="/forgot-password">Forgot password?</Link>
            </div>
            <div className="auth-alt">
              New to PartsPort? <Link href="/register">Create an account</Link>
            </div>
            <div className="demo-creds">
              <strong>Demo accounts</strong> (password <code>demo1234</code>):
              <br />
              Buyer <code>buyer@partsport.example</code>
              <br />
              Supplier <code>supplier@partsport.example</code>
              <br />
              Admin <code>admin@partsport.example</code>
            </div>
          </>
        ) : (
          <form onSubmit={submit2fa}>
            <p style={{ fontSize: 14, marginBottom: 12 }}>
              Two-factor required. Enter the 6-digit code from your
              authenticator app, or one of your saved backup codes.
            </p>
            <div className="form-row">
              <label htmlFor="otp">Authenticator code</label>
              <input
                id="otp"
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
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Verifying…" : "Verify and sign in"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-block"
              style={{ marginTop: 8 }}
              onClick={() => {
                setStep("password");
                setCode("");
                setTicket("");
                setError("");
              }}
              disabled={busy}
            >
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

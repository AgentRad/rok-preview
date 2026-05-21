"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const HOME: Record<string, string> = {
  ADMIN: "/admin",
  SUPPLIER: "/supplier",
  BUYER: "/account",
};

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Sign in failed.");
      setBusy(false);
      return;
    }
    router.push(HOME[data.role] || "/");
    router.refresh();
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Sign in</h1>
        <p className="sub">Welcome back to PartsPort.</p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={submit}>
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
      </div>
    </div>
  );
}

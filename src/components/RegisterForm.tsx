"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not create account.");
      setBusy(false);
      return;
    }
    router.push("/account");
    router.refresh();
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Create your account</h1>
        <p className="sub">Free for buyers. Order parts in minutes.</p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={submit}>
          <div className="form-row">
            <label htmlFor="name">Full name</label>
            <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="form-row">
            <label htmlFor="email">Work email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-row">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>
        <div className="auth-alt">
          Already have an account? <Link href="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}

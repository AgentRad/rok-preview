"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Role = "buyer" | "distributor" | "manufacturer";

const ROLE_COPY: Record<Role, { title: string; body: string }> = {
  buyer: {
    title: "I am a buyer",
    body: "I source industrial parts and equipment for a utility, co-op, contractor, EPC, fabrication shop, or other operator.",
  },
  distributor: {
    title: "I am a distributor / supplier",
    body: "My company stocks and sells industrial parts, with authorized-distributor relationships with one or more OEMs.",
  },
  manufacturer: {
    title: "I am a manufacturer (OEM)",
    body: "My company designs and builds the equipment itself (e.g. transformers, switchgear, breakers, generators).",
  },
};

export default function RegisterForm() {
  const router = useRouter();
  const [role, setRole] = useState<Role>("buyer");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (role === "distributor") {
      router.push("/suppliers#apply");
      return;
    }
    if (role === "manufacturer") {
      router.push("/manufacturers#apply");
      return;
    }
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
    // PLH-1 commit 2: registration no longer auto-signs-in. Send the
    // user to the verify-email-pending page with the address pre-filled
    // so they know to check their inbox.
    const dest = `/verify-email-pending?email=${encodeURIComponent(email)}`;
    router.push(dest);
    router.refresh();
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Create your account</h1>
        <p className="sub">
          Buyers sign up for free in seconds. Distributors and manufacturers go
          through a vetted onboarding so buyers know who they are dealing with.
        </p>

        <div className="role-picker" role="radiogroup" aria-label="Account type">
          {(Object.keys(ROLE_COPY) as Role[]).map((r) => (
            <button
              type="button"
              key={r}
              role="radio"
              aria-checked={role === r}
              className={"role-option" + (role === r ? " on" : "")}
              onClick={() => setRole(r)}
            >
              <div className="role-title">{ROLE_COPY[r].title}</div>
              <div className="role-body">{ROLE_COPY[r].body}</div>
            </button>
          ))}
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {role === "buyer" && (
          <form onSubmit={submit}>
            <div className="form-row">
              <label htmlFor="name">Full name</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="form-row">
              <label htmlFor="email">Work email</label>
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
                minLength={8}
                required
              />
            </div>
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Creating account…" : "Create buyer account"}
            </button>
          </form>
        )}

        {role === "distributor" && (
          <div>
            <p style={{ fontSize: 14, marginBottom: 14 }}>
              Distributors and suppliers apply through our vetting process so
              buyers know your business, certifications, and OEM authorizations
              are real. We approve most applications within a business day.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => router.push("/suppliers#apply")}
            >
              Apply as a distributor &rarr;
            </button>
          </div>
        )}

        {role === "manufacturer" && (
          <div>
            <p style={{ fontSize: 14, marginBottom: 14 }}>
              Manufacturers (OEMs) participate free with a branded storefront
              and demand intelligence. No transaction fees; sales route to your
              authorized distributors.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => router.push("/manufacturers#apply")}
            >
              List your brand as a manufacturer &rarr;
            </button>
          </div>
        )}

        <div className="auth-alt">
          Already have an account? <Link href="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}

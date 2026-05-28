"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type InviteState = {
  email: string;
  role: string;
  orgName: string;
  signedIn: boolean;
  signedInAs?: string;
  existingUser: boolean;
};

export default function BuyerOrgInviteAccept({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<InviteState | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/buyer-org-invites/${token}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          setError(data.error || "Invite not found.");
          return;
        }
        setState(data);
      })
      .catch(() => setError("Could not load this invite."));
  }, [token]);

  async function acceptAsExisting() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/buyer-org-invites/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not accept the invite.");
        return;
      }
      router.push("/account");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function acceptAsNew(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/buyer-org-invites/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ register: true, name, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not accept the invite.");
        return;
      }
      router.push("/account");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>Invitation</h1>
          <div className="alert alert-error">{error}</div>
          <Link className="btn btn-ghost btn-block" href="/login">
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <p className="muted-text">Loading invite…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Join {state.orgName}</h1>
        <p className="sub">
          You've been added to {state.orgName} on PartsPort as a{" "}
          <strong>{state.role.toLowerCase()}</strong>.
        </p>
        {state.signedIn && state.signedInAs === state.email ? (
          <>
            <p style={{ fontSize: 14, marginBottom: 12 }}>
              Signed in as <strong>{state.signedInAs}</strong>. Click below to
              join the organization.
            </p>
            <button className="btn btn-primary btn-block" onClick={acceptAsExisting} disabled={busy}>
              {busy ? "Joining…" : `Join ${state.orgName}`}
            </button>
          </>
        ) : state.existingUser ? (
          <>
            <p style={{ fontSize: 14, marginBottom: 12 }}>
              An account already exists for <strong>{state.email}</strong>. Sign
              in with that account, then come back to this link.
            </p>
            <Link className="btn btn-primary btn-block" href="/login">
              Sign in
            </Link>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, marginBottom: 12 }}>
              Create your PartsPort account to accept. Email is locked to the
              invite address (<strong>{state.email}</strong>).
            </p>
            <form onSubmit={acceptAsNew}>
              <div className="form-row">
                <label htmlFor="bo-in-name">Your full name</label>
                <input
                  id="bo-in-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="form-row">
                <label htmlFor="bo-in-pw">Choose a password</label>
                <input
                  id="bo-in-pw"
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <button className="btn btn-primary btn-block" disabled={busy}>
                {busy ? "Joining…" : `Create account and join ${state.orgName}`}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

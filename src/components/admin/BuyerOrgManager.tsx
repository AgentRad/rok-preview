"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Member = {
  id: string;
  role: string;
  user: { id: string; name: string; email: string };
};
type Invite = { id: string; email: string; role: string; expiresAt: string };

const ROLES = ["ADMIN", "APPROVER", "BUYER", "VIEWER"];

export default function BuyerOrgManager({
  orgId,
  initialMembers,
  initialInvites,
}: {
  orgId: string;
  initialMembers: Member[];
  initialInvites: Invite[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("BUYER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const trimmed = email.toLowerCase().trim();
    try {
      // Try adding an existing account first.
      const res = await fetch(`/api/admin/buyer-orgs/${orgId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, role }),
      });
      if (res.ok) {
        setEmail("");
        setNotice(`Added ${trimmed}.`);
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) {
        // No account yet: fall through to an invite.
        const inv = await fetch(`/api/admin/buyer-orgs/${orgId}/invites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed, role }),
        });
        const invData = await inv.json().catch(() => ({}));
        if (!inv.ok) {
          setError(invData.error || "Could not send the invite.");
          return;
        }
        setEmail("");
        setNotice(`Invite sent to ${trimmed}.`);
        router.refresh();
        return;
      }
      setError(data.error || "Could not add the member.");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(id: string) {
    setError("");
    const res = await fetch(`/api/admin/buyer-orgs/${orgId}/members/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not remove the member.");
      return;
    }
    router.refresh();
  }

  async function cancelInvite(id: string) {
    setError("");
    const res = await fetch(`/api/admin/buyer-orgs/${orgId}/invites/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not cancel the invite.");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-body">
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>Add a member</h2>
          <form onSubmit={addMember} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label htmlFor="bo-email" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
                Email
              </label>
              <input
                id="bo-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="buyer@company.com"
                required
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label htmlFor="bo-role" style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
                Role
              </label>
              <select id="bo-role" value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary" disabled={busy || !email.trim()}>
              {busy ? "Working…" : "Add or invite"}
            </button>
          </form>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            Existing accounts are added immediately. New emails get an invite link.
          </p>
          {notice && (
            <div className="alert alert-success" style={{ marginTop: 10 }}>
              {notice}
            </div>
          )}
          {error && (
            <div className="alert alert-error" style={{ marginTop: 10 }}>
              {error}
            </div>
          )}
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-body">
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>Members</h2>
          {initialMembers.length === 0 ? (
            <p className="muted">No members yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {initialMembers.map((m) => (
                  <tr key={m.id}>
                    <td>{m.user.name}</td>
                    <td>{m.user.email}</td>
                    <td>{m.role}</td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => removeMember(m.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {initialInvites.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-body">
            <h2 style={{ fontSize: 16, marginBottom: 12 }}>Pending invites</h2>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {initialInvites.map((i) => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td>{i.role}</td>
                    <td>{new Date(i.expiresAt).toLocaleDateString()}</td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => cancelInvite(i.id)}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

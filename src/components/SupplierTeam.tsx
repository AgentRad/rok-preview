"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Member = {
  id: string;
  role: "OWNER" | "MEMBER";
  createdAt: string;
  user: { id: string; name: string; email: string };
};

type Invite = {
  id: string;
  email: string;
  role: "OWNER" | "MEMBER";
  expiresAt: string;
};

type TeamState = {
  role: "OWNER" | "MEMBER";
  canManageTeam: boolean;
  members: Member[];
  invites: Invite[];
};

export default function SupplierTeam() {
  const router = useRouter();
  const [state, setState] = useState<TeamState | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"OWNER" | "MEMBER">("MEMBER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function reload() {
    const res = await fetch("/api/supplier/team");
    if (!res.ok) return;
    setState(await res.json());
  }

  useEffect(() => {
    reload();
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/supplier/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not invite.");
        return;
      }
      setNotice(
        data.added === "existing-user"
          ? `${email} was already on PartsPort and has been added to the team.`
          : `Invite sent to ${email}. It expires in 14 days.`
      );
      setEmail("");
      await reload();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(id: string) {
    if (!confirm("Remove this team member?")) return;
    const res = await fetch(`/api/supplier/team/${id}`, { method: "DELETE" });
    if (res.ok) {
      await reload();
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Could not remove member.");
    }
  }

  async function changeRole(id: string, next: "OWNER" | "MEMBER") {
    const res = await fetch(`/api/supplier/team/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: next }),
    });
    if (res.ok) {
      await reload();
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Could not change role.");
    }
  }

  async function cancelInvite(id: string) {
    if (!confirm("Cancel this pending invite?")) return;
    const res = await fetch(`/api/supplier/team/invites/${id}`, { method: "DELETE" });
    if (res.ok) {
      await reload();
      router.refresh();
    }
  }

  if (!state) {
    return <p className="muted-text" style={{ fontSize: 13 }}>Loading team…</p>;
  }

  return (
    <div>
      {state.members.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 18 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {state.members.map((m) => (
                <tr key={m.id}>
                  <td>{m.user.name}</td>
                  <td className="muted-text" style={{ fontSize: 13 }}>{m.user.email}</td>
                  <td>
                    <span
                      className={
                        "badge " +
                        (m.role === "OWNER" ? "badge-fulfilled" : "badge-paid")
                      }
                    >
                      {m.role}
                    </span>
                  </td>
                  <td>{new Date(m.createdAt).toLocaleDateString()}</td>
                  <td>
                    {state.canManageTeam && (
                      <div className="row-gap">
                        {m.role === "MEMBER" ? (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => changeRole(m.id, "OWNER")}
                          >
                            Promote to owner
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => changeRole(m.id, "MEMBER")}
                          >
                            Demote to member
                          </button>
                        )}
                        <button
                          type="button"
                          className="link-btn link-btn-danger"
                          onClick={() => removeMember(m.id)}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {state.invites.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div
            className="invoice-meta-label"
            style={{ marginBottom: 8 }}
          >
            Pending invites
          </div>
          <ul className="return-list">
            {state.invites.map((inv) => (
              <li key={inv.id} className="return-item">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <strong>{inv.email}</strong>{" "}
                    <span className="muted-text" style={{ fontSize: 12.5 }}>
                      ({inv.role.toLowerCase()}, expires {new Date(inv.expiresAt).toLocaleDateString()})
                    </span>
                  </div>
                  {state.canManageTeam && (
                    <button
                      type="button"
                      className="link-btn link-btn-danger"
                      onClick={() => cancelInvite(inv.id)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.canManageTeam ? (
        <form onSubmit={invite}>
          {notice && <div className="alert alert-ok">{notice}</div>}
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-row two">
            <div>
              <label htmlFor="ti-email">Invite email</label>
              <input
                id="ti-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="ti-role">Role</label>
              <select
                id="ti-role"
                value={role}
                onChange={(e) => setRole(e.target.value as "OWNER" | "MEMBER")}
              >
                <option value="MEMBER">Member (catalog, orders, RFQs, payouts)</option>
                <option value="OWNER">Owner (also can manage team)</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy || !email}>
            {busy ? "Sending…" : "Send invite"}
          </button>
        </form>
      ) : (
        <p className="muted-text" style={{ fontSize: 13 }}>
          Only the supplier owner can invite or remove team members.
        </p>
      )}
    </div>
  );
}

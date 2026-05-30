"use client";
import { useState } from "react";
import { formatCents } from "@/lib/money";

type Rule = {
  id: string;
  name: string;
  minTotalCents: number | null;
  maxTotalCents: number | null;
  supplierId: string | null;
  approverMemberId: string | null;
  approverRole: string | null;
  chainGroup: string | null;
  chainOrder: number;
  escalateAfterHours: number | null;
  escalateToMemberId: string | null;
  autoApproveIfHistoricalMatch: boolean;
  enabled: boolean;
  createdAt: string;
};

type Member = { id: string; label: string };

type Props = {
  initialRules: Rule[];
  members: Member[];
};

const ROLES = ["ADMIN", "APPROVER", "BUYER", "VIEWER"];

export default function ApprovalRulesClient({ initialRules, members }: Props) {
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const emptyDraft = (): Partial<Rule> => ({
    name: "",
    minTotalCents: null,
    maxTotalCents: null,
    supplierId: null,
    approverMemberId: null,
    approverRole: null,
    chainGroup: null,
    chainOrder: 0,
    escalateAfterHours: null,
    escalateToMemberId: null,
    autoApproveIfHistoricalMatch: false,
    enabled: true,
  });
  const [draft, setDraft] = useState<Partial<Rule>>(emptyDraft());

  function startEdit(rule: Rule) {
    setDraft({ ...rule });
    setEditingId(rule.id);
    setShowForm(true);
  }

  function startNew() {
    setDraft(emptyDraft());
    setEditingId(null);
    setShowForm(true);
  }

  async function save() {
    setBusy("save");
    try {
      const body = {
        name: draft.name,
        minTotalCents: draft.minTotalCents,
        maxTotalCents: draft.maxTotalCents,
        supplierId: draft.supplierId || null,
        approverMemberId: draft.approverMemberId || null,
        approverRole: draft.approverRole || null,
        chainGroup: draft.chainGroup || null,
        chainOrder: draft.chainOrder ?? 0,
        escalateAfterHours: draft.escalateAfterHours,
        escalateToMemberId: draft.escalateToMemberId || null,
        autoApproveIfHistoricalMatch: draft.autoApproveIfHistoricalMatch,
        enabled: draft.enabled !== false,
      };

      let res: Response;
      if (editingId) {
        res = await fetch(`/api/buyer-org/approval-rules/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/buyer-org/approval-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      if (res.ok) {
        const data = await res.json();
        if (editingId) {
          setRules((prev) => prev.map((r) => (r.id === editingId ? { ...data.rule, createdAt: data.rule.createdAt ?? r.createdAt } : r)));
        } else {
          setRules((prev) => [...prev, { ...data.rule, createdAt: data.rule.createdAt ?? new Date().toISOString() }]);
        }
        setShowForm(false);
        setEditingId(null);
        setDraft(emptyDraft());
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Could not save rule.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function deleteRule(id: string, name: string) {
    if (!confirm(`Delete rule "${name}"? This cannot be undone.`)) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/buyer-org/approval-rules/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRules((prev) => prev.filter((r) => r.id !== id));
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Could not delete rule.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled(rule: Rule) {
    setBusy(rule.id);
    try {
      const res = await fetch(`/api/buyer-org/approval-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (res.ok) {
        const data = await res.json();
        setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: data.rule.enabled } : r)));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {rules.length === 0 && !showForm && (
        <p className="muted" style={{ padding: "1.5rem 0" }}>
          No rules configured. Orders from this org will not require approval.
        </p>
      )}

      {rules.map((rule) => (
        <div key={rule.id} className="card" style={{ marginBottom: "0.75rem", padding: "1rem 1.25rem", opacity: rule.enabled ? 1 : 0.6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <strong>{rule.name}</strong>
              {!rule.enabled && <span className="muted" style={{ marginLeft: "0.5rem", fontSize: "0.8rem" }}>(disabled)</span>}
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn-sm btn-outline" onClick={() => startEdit(rule)} disabled={busy === rule.id}>Edit</button>
              <button className="btn btn-sm btn-outline" onClick={() => toggleEnabled(rule)} disabled={busy === rule.id}>
                {rule.enabled ? "Disable" : "Enable"}
              </button>
              <button className="btn btn-sm btn-outline" style={{ color: "var(--red, #b91c1c)" }} onClick={() => deleteRule(rule.id, rule.name)} disabled={busy === rule.id}>Delete</button>
            </div>
          </div>
          <div className="muted" style={{ fontSize: "0.83rem", marginTop: "0.4rem" }}>
            {rule.minTotalCents !== null && <span>Min: {formatCents(rule.minTotalCents)} </span>}
            {rule.maxTotalCents !== null && <span>Max: {formatCents(rule.maxTotalCents)} </span>}
            {rule.approverMemberId && <span>Approver member ID: {rule.approverMemberId} </span>}
            {rule.approverRole && <span>Approver role: {rule.approverRole} </span>}
            {rule.escalateAfterHours && <span>Escalate after {rule.escalateAfterHours}h </span>}
            {rule.autoApproveIfHistoricalMatch && <span>Auto-approve on history match </span>}
            {rule.chainGroup && <span>Chain: {rule.chainGroup}/{rule.chainOrder} </span>}
          </div>
        </div>
      ))}

      {!showForm && (
        <button className="btn btn-sm" style={{ marginTop: "0.5rem" }} onClick={startNew}>
          Add rule
        </button>
      )}

      {showForm && (
        <div className="card" style={{ padding: "1.25rem", marginTop: "1rem" }}>
          <h3 style={{ marginBottom: "1rem" }}>{editingId ? "Edit rule" : "New rule"}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <label style={{ gridColumn: "1/-1" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--mid)" }}>Rule name</span>
              <input
                type="text"
                value={draft.name ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                maxLength={120}
                style={{ display: "block", width: "100%", padding: "0.4rem 0.5rem", marginTop: "0.2rem", border: "1px solid var(--border)", borderRadius: 3, fontSize: "0.9rem" }}
              />
            </label>
            <label>
              <span style={{ fontSize: "0.85rem", color: "var(--mid)" }}>Min total ($)</span>
              <input
                type="number"
                min={0}
                value={draft.minTotalCents != null ? draft.minTotalCents / 100 : ""}
                onChange={(e) => setDraft((d) => ({ ...d, minTotalCents: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null }))}
                style={{ display: "block", width: "100%", padding: "0.4rem 0.5rem", marginTop: "0.2rem", border: "1px solid var(--border)", borderRadius: 3, fontSize: "0.9rem" }}
              />
            </label>
            <label>
              <span style={{ fontSize: "0.85rem", color: "var(--mid)" }}>Max total ($)</span>
              <input
                type="number"
                min={0}
                value={draft.maxTotalCents != null ? draft.maxTotalCents / 100 : ""}
                onChange={(e) => setDraft((d) => ({ ...d, maxTotalCents: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null }))}
                style={{ display: "block", width: "100%", padding: "0.4rem 0.5rem", marginTop: "0.2rem", border: "1px solid var(--border)", borderRadius: 3, fontSize: "0.9rem" }}
              />
            </label>
            <label>
              <span style={{ fontSize: "0.85rem", color: "var(--mid)" }}>Approver member</span>
              <select
                value={draft.approverMemberId ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, approverMemberId: e.target.value || null }))}
                style={{ display: "block", width: "100%", padding: "0.4rem 0.5rem", marginTop: "0.2rem", border: "1px solid var(--border)", borderRadius: 3, fontSize: "0.9rem" }}
              >
                <option value="">Any role-based</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span style={{ fontSize: "0.85rem", color: "var(--mid)" }}>Or approver role</span>
              <select
                value={draft.approverRole ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, approverRole: e.target.value || null }))}
                style={{ display: "block", width: "100%", padding: "0.4rem 0.5rem", marginTop: "0.2rem", border: "1px solid var(--border)", borderRadius: 3, fontSize: "0.9rem" }}
              >
                <option value="">Not set</option>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label>
              <span style={{ fontSize: "0.85rem", color: "var(--mid)" }}>Escalate after (hours)</span>
              <input
                type="number"
                min={1}
                value={draft.escalateAfterHours ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, escalateAfterHours: e.target.value ? parseInt(e.target.value, 10) : null }))}
                style={{ display: "block", width: "100%", padding: "0.4rem 0.5rem", marginTop: "0.2rem", border: "1px solid var(--border)", borderRadius: 3, fontSize: "0.9rem" }}
              />
            </label>
            <label>
              <span style={{ fontSize: "0.85rem", color: "var(--mid)" }}>Escalate to member</span>
              <select
                value={draft.escalateToMemberId ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, escalateToMemberId: e.target.value || null }))}
                style={{ display: "block", width: "100%", padding: "0.4rem 0.5rem", marginTop: "0.2rem", border: "1px solid var(--border)", borderRadius: 3, fontSize: "0.9rem" }}
              >
                <option value="">None</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={draft.autoApproveIfHistoricalMatch ?? false}
                onChange={(e) => setDraft((d) => ({ ...d, autoApproveIfHistoricalMatch: e.target.checked }))}
              />
              <span style={{ fontSize: "0.85rem", color: "var(--mid)" }}>Auto-approve if historical match</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={draft.enabled !== false}
                onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
              />
              <span style={{ fontSize: "0.85rem", color: "var(--mid)" }}>Enabled</span>
            </label>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
            <button className="btn btn-sm" disabled={busy === "save" || !draft.name?.trim()} onClick={save}>
              {busy === "save" ? "Saving..." : "Save rule"}
            </button>
            <button className="btn btn-sm btn-outline" onClick={() => { setShowForm(false); setEditingId(null); setDraft(emptyDraft()); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

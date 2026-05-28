"use client";
import { useState, useEffect, useCallback } from "react";
import { formatCents } from "@/lib/money";

type ApprovalStep = {
  id: string;
  outcome: string;
  approverMemberId: string | null;
  chainOrder: number;
  reason: string;
  decidedAt: string | null;
  createdAt: string;
};

type PendingOrder = {
  id: string;
  reference: string;
  buyerName: string;
  buyerEmail: string;
  totalCents: number;
  createdAt: string;
  approvalStatus: string;
  approvals: ApprovalStep[];
};

type Props = {
  orgName: string;
  isAdmin: boolean;
};

export default function ApprovalsClient({ isAdmin }: Props) {
  const [tab, setTab] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rejectModal, setRejectModal] = useState<{ orderId: string; ref: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async (status: string) => {
    setLoading(true);
    setSelected(new Set());
    try {
      const res = await fetch(`/api/buyer-org/approvals?status=${status}`);
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  async function decide(orderId: string, decision: "APPROVE" | "REJECT", reason?: string) {
    setBusy(orderId);
    try {
      const res = await fetch(`/api/buyer-org/approvals/${orderId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      if (res.ok) {
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
        setSelected((prev) => { const s = new Set(prev); s.delete(orderId); return s; });
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Could not process this request.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function bulkApprove() {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/buyer-org/approvals/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: Array.from(selected) }),
      });
      if (res.ok) {
        const data = await res.json();
        const approved = (data.results as { orderId: string; status: string }[])
          .filter((r) => r.status === "APPROVED" || r.status === "PENDING")
          .map((r) => r.orderId);
        setOrders((prev) => prev.filter((o) => !approved.includes(o.id)));
        setSelected(new Set());
      }
    } finally {
      setBulkBusy(false);
    }
  }

  const tabs = [
    { key: "PENDING" as const, label: "Pending" },
    { key: "APPROVED" as const, label: "Approved" },
    { key: "REJECTED" as const, label: "Rejected" },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", borderBottom: "1px solid var(--border)" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0.5rem 0",
              fontWeight: tab === t.key ? 700 : 400,
              borderBottom: tab === t.key ? "2px solid var(--near-black)" : "2px solid transparent",
              fontSize: "0.9rem",
              color: tab === t.key ? "var(--near-black)" : "var(--mid)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <p className="muted">Loading...</p>}

      {!loading && orders.length === 0 && (
        <p className="muted" style={{ padding: "2rem 0" }}>
          {tab === "PENDING"
            ? "No orders are currently waiting for approval."
            : `No ${tab.toLowerCase()} orders.`}
        </p>
      )}

      {!loading && tab === "PENDING" && orders.length > 0 && isAdmin && (
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
          <label style={{ fontSize: "0.85rem", color: "var(--mid)", display: "flex", gap: "0.4rem", alignItems: "center", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={selected.size === orders.length && orders.length > 0}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(orders.map((o) => o.id)) : new Set())
              }
            />
            Select all
          </label>
          {selected.size > 0 && (
            <button
              className="btn btn-sm"
              disabled={bulkBusy}
              onClick={bulkApprove}
            >
              {bulkBusy ? "Approving..." : `Approve ${selected.size} selected`}
            </button>
          )}
        </div>
      )}

      {!loading && orders.map((order) => {
        const activeStep = order.approvals.find((a) => a.outcome === "PENDING");
        const isAssignedToMe = activeStep != null; // best effort; real check is server-side
        const canAct = tab === "PENDING" && (isAdmin || isAssignedToMe);
        return (
          <div
            key={order.id}
            className="card"
            style={{ marginBottom: "1rem", padding: "1rem 1.25rem" }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
              {tab === "PENDING" && isAdmin && (
                <input
                  type="checkbox"
                  checked={selected.has(order.id)}
                  onChange={(e) => {
                    setSelected((prev) => {
                      const s = new Set(prev);
                      if (e.target.checked) s.add(order.id); else s.delete(order.id);
                      return s;
                    });
                  }}
                  style={{ marginTop: 3 }}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <a
                    href={`/orders/${order.id}`}
                    style={{ fontWeight: 600, color: "var(--near-black)", textDecoration: "none" }}
                  >
                    {order.reference}
                  </a>
                  <span style={{ fontWeight: 600 }}>{formatCents(order.totalCents)}</span>
                </div>
                <div className="muted" style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
                  {order.buyerName} ({order.buyerEmail}) &middot;{" "}
                  {new Date(order.createdAt).toLocaleDateString()}
                </div>
                {order.approvals.length > 0 && (
                  <div style={{ marginTop: "0.5rem", fontSize: "0.82rem", color: "var(--mid)" }}>
                    {order.approvals.map((a, i) => (
                      <span key={a.id}>
                        {i > 0 && " → "}
                        <span style={{ color: a.outcome === "APPROVED" ? "var(--green, #22843a)" : a.outcome === "REJECTED" ? "var(--red, #b91c1c)" : "var(--mid)" }}>
                          {a.outcome === "PENDING" ? "Awaiting step " + (a.chainOrder + 1) : a.outcome}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {canAct && (
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                <button
                  className="btn btn-sm"
                  disabled={busy === order.id}
                  onClick={() => decide(order.id, "APPROVE")}
                >
                  {busy === order.id ? "..." : "Approve"}
                </button>
                <button
                  className="btn btn-sm btn-outline"
                  disabled={busy === order.id}
                  onClick={() => {
                    setRejectModal({ orderId: order.id, ref: order.reference });
                    setRejectReason("");
                  }}
                >
                  Reject
                </button>
                <a href={`/orders/${order.id}`} className="btn btn-sm btn-outline">
                  View order
                </a>
              </div>
            )}
          </div>
        );
      })}

      {/* Reject reason modal */}
      {rejectModal && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex",
            alignItems: "center", justifyContent: "center", zIndex: 200,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setRejectModal(null); }}
        >
          <div className="card" style={{ width: "min(480px, 90vw)", padding: "1.5rem" }}>
            <h3 style={{ marginBottom: "1rem" }}>Reject order {rejectModal.ref}</h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (optional, shared with the buyer)"
              maxLength={500}
              rows={3}
              style={{ width: "100%", marginBottom: "1rem", padding: "0.5rem", fontSize: "0.9rem", border: "1px solid var(--border)", borderRadius: 4 }}
            />
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
              <button className="btn btn-sm btn-outline" onClick={() => setRejectModal(null)}>
                Cancel
              </button>
              <button
                className="btn btn-sm"
                style={{ background: "var(--red, #b91c1c)", color: "#fff", border: "none" }}
                disabled={busy === rejectModal.orderId}
                onClick={async () => {
                  await decide(rejectModal.orderId, "REJECT", rejectReason);
                  setRejectModal(null);
                }}
              >
                Confirm rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

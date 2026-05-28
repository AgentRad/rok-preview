"use client";

import { useState } from "react";
import Link from "next/link";
import ReorderButton from "@/components/ReorderButton";
import UnreadBadge from "@/components/UnreadBadge";
import { formatCents } from "@/lib/money";

const STATUS_CLASS: Record<string, string> = {
  PENDING: "badge-pending",
  PAID: "badge-paid",
  FULFILLED: "badge-fulfilled",
  CANCELLED: "badge-cancelled",
};

export type OrderRow = {
  id: string;
  reference: string;
  createdAt: string;
  status: string;
  totalCents: number;
  qtyTotal: number;
  /** PLH-3v: enterprise PO number, optional. Column renders only when at
   *  least one row in the visible page has a value. */
  purchaseOrderNumber?: string | null;
};

/**
 * PLH-3j P10: paginated order history. Initial 25 rows render server-
 * side; subsequent pages stream in from /api/account/orders?page=N.
 */
export default function OrderHistoryTable({
  initial,
  totalCount,
  pageSize,
  unreadByOrderId,
}: {
  initial: OrderRow[];
  totalCount: number;
  pageSize: number;
  /** PLH-3p F4: optional unread message count per order id. Renders a
   *  small red dot next to the reference when > 0. */
  unreadByOrderId?: Record<string, number>;
}) {
  const [rows, setRows] = useState<OrderRow[]>(initial);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // PLH-3v: search by purchaseOrderNumber substring.
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [filtered, setFiltered] = useState(false);

  const hasMore = filtered
    ? rows.length >= pageSize && rows.length % pageSize === 0
    : rows.length < totalCount;
  const showPoColumn = rows.some((r) => !!r.purchaseOrderNumber);

  async function loadMore() {
    if (busy || !hasMore) return;
    setBusy(true);
    setError("");
    try {
      const qs = new URLSearchParams({ page: String(page + 1) });
      if (filtered && q.trim()) qs.set("q", q.trim());
      const res = await fetch(`/api/account/orders?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not load more orders.");
        return;
      }
      setRows((r) => [...r, ...(data.orders as OrderRow[])]);
      setPage((p) => p + 1);
    } finally {
      setBusy(false);
    }
  }

  async function runSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSearching(true);
    setError("");
    try {
      const trimmed = q.trim();
      const qs = new URLSearchParams({ page: "1" });
      if (trimmed) qs.set("q", trimmed);
      const res = await fetch(`/api/account/orders?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not search orders.");
        return;
      }
      setRows(data.orders as OrderRow[]);
      setPage(1);
      setFiltered(!!trimmed);
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setQ("");
    setRows(initial);
    setPage(1);
    setFiltered(false);
  }

  if (rows.length === 0) {
    return (
      <div className="empty-block">
        <h3>No orders yet</h3>
        <p>When you place an order it will appear here.</p>
      </div>
    );
  }

  return (
    <>
      <form
        onSubmit={runSearch}
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          margin: "8px 0 12px",
          flexWrap: "wrap",
        }}
      >
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value.slice(0, 64))}
          maxLength={64}
          placeholder="Search by PO number"
          style={{ maxWidth: 240 }}
        />
        <button
          type="submit"
          className="btn btn-ghost btn-sm"
          disabled={searching}
        >
          {searching ? "Searching" : "Search"}
        </button>
        {filtered && (
          <button
            type="button"
            className="link-btn"
            onClick={clearSearch}
            style={{ fontSize: 12 }}
          >
            Clear
          </button>
        )}
      </form>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Reference</th>
              {showPoColumn && <th>PO #</th>}
              <th>Date</th>
              <th>Items</th>
              <th>Status</th>
              <th className="num">Total</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const isPaid = o.status === "PAID" || o.status === "FULFILLED";
              return (
                <tr key={o.id}>
                  <td style={{ fontWeight: 700 }}>
                    {o.reference}
                    <UnreadBadge
                      count={unreadByOrderId?.[o.id] ?? 0}
                      variant="dot"
                      ariaLabel="Unread messages"
                    />
                  </td>
                  {showPoColumn && (
                    <td className="muted-text" style={{ fontSize: 12.5 }}>
                      {o.purchaseOrderNumber || ""}
                    </td>
                  )}
                  <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                  <td>{`${o.qtyTotal} item${o.qtyTotal === 1 ? "" : "s"}`}</td>
                  <td>
                    <span className={"badge " + (STATUS_CLASS[o.status] || "")}>
                      {o.status}
                    </span>
                  </td>
                  <td className="num">{formatCents(o.totalCents)}</td>
                  <td className="num">
                    <div
                      style={{
                        display: "inline-flex",
                        gap: 10,
                        alignItems: "center",
                        flexWrap: "wrap",
                        justifyContent: "flex-end",
                      }}
                    >
                      <Link
                        href={`/orders/${o.id}`}
                        style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
                      >
                        View
                      </Link>
                      {isPaid && (
                        <Link
                          href={`/orders/${o.id}/invoice`}
                          style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
                        >
                          Invoice
                        </Link>
                      )}
                      <ReorderButton orderId={o.id} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
        <span className="muted-text" style={{ fontSize: 12.5 }}>
          Showing {rows.length} of {totalCount}
        </span>
        {hasMore && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={loadMore}
            disabled={busy}
          >
            {busy ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
      {error && (
        <div className="alert alert-error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </>
  );
}

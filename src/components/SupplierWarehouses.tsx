"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type WarehouseRow = {
  id: string;
  label: string;
  zip: string;
  city: string;
  state: string;
  isDefault: boolean;
};

/**
 * Supplier dashboard widget for managing origin warehouses. List, add,
 * set default, delete. Default warehouse drives checkout-time freight
 * quoting for orders that include this supplier's products.
 */
export default function SupplierWarehouses({
  initial,
}: {
  initial: WarehouseRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<WarehouseRow[]>(initial);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    label: "",
    zip: "",
    city: "",
    state: "",
  });

  function setField(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/supplier/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not add warehouse.");
        return;
      }
      setRows((prev) =>
        // New default demotes the previous one in our local view.
        prev
          .map((r) =>
            data.warehouse.isDefault ? { ...r, isDefault: false } : r
          )
          .concat([data.warehouse])
      );
      setForm({ label: "", zip: "", city: "", state: "" });
      setShowForm(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/supplier/warehouses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not update default.");
        return;
      }
      setRows((prev) =>
        prev.map((r) => ({ ...r, isDefault: r.id === id }))
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/supplier/warehouses/${id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not delete.");
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p
        className="muted-text"
        style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 10 }}
      >
        Origin ZIPs for freight quoting. Buyers see real-time LTL freight
        rates at checkout based on your default warehouse plus the
        product&rsquo;s weight + dimensions.
      </p>
      {rows.length === 0 ? (
        <div className="empty-block">
          <h3>No warehouses yet</h3>
          <p>Add one to enable real-rate freight quotes for your products.</p>
        </div>
      ) : (
        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Label</th>
                <th>City</th>
                <th>State</th>
                <th>ZIP</th>
                <th>Default</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>
                    {r.label || "(no label)"}
                  </td>
                  <td>{r.city}</td>
                  <td>{r.state}</td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 13 }}>
                    {r.zip}
                  </td>
                  <td>
                    {r.isDefault ? (
                      <span className="badge badge-approved">Default</span>
                    ) : (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setDefault(r.id)}
                        disabled={busy}
                      >
                        Set default
                      </button>
                    )}
                  </td>
                  <td className="num">
                    <button
                      type="button"
                      className="link-btn link-btn-danger"
                      onClick={() => remove(r.id)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm ? (
        <form
          onSubmit={add}
          style={{
            paddingTop: 10,
            borderTop: "1px solid var(--line)",
          }}
        >
          <div className="form-row" style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1fr", gap: 8 }}>
            <div>
              <label>Label</label>
              <input
                value={form.label}
                onChange={(e) => setField("label", e.target.value)}
                placeholder="Denver hub"
              />
            </div>
            <div>
              <label>City</label>
              <input
                value={form.city}
                onChange={(e) => setField("city", e.target.value)}
                required
              />
            </div>
            <div>
              <label>State</label>
              <input
                value={form.state}
                onChange={(e) => setField("state", e.target.value.toUpperCase())}
                maxLength={2}
                required
                placeholder="CO"
              />
            </div>
            <div>
              <label>ZIP</label>
              <input
                value={form.zip}
                onChange={(e) => setField("zip", e.target.value)}
                required
                placeholder="80202"
              />
            </div>
          </div>
          {error && (
            <div className="alert alert-error" style={{ marginTop: 8 }}>
              {error}
            </div>
          )}
          <div className="row-gap" style={{ marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? "Adding…" : "Add warehouse"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setShowForm(false);
                setError("");
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setShowForm(true)}
        >
          Add a warehouse
        </button>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ICON_KEYS } from "./PartIcon";
import { formatCents } from "@/lib/money";

export type SupplierProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  manufacturer: string;
  priceCents: number;
  unit: string;
  etaDays: number;
  stock: number;
  active: boolean;
};

const CATEGORIES = [
  "Bearings", "Hydraulics", "Pneumatics", "Motors & Drives", "Electrical",
  "Belts & Pulleys", "Sensors", "Valves", "Fasteners", "Power Transmission",
  "Seals & Gaskets", "Cutting Tools",
];

function Row({ p }: { p: SupplierProduct }) {
  const router = useRouter();
  const [price, setPrice] = useState((p.priceCents / 100).toFixed(2));
  const [stock, setStock] = useState(String(p.stock));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/supplier/products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price: Number(price), stock: Number(stock) }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg("Saved");
      router.refresh();
    } else {
      setMsg("Error");
    }
  }

  async function toggleActive() {
    await fetch(`/api/supplier/products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !p.active }),
    });
    router.refresh();
  }

  return (
    <tr>
      <td>
        <div style={{ fontWeight: 600 }}>{p.name}</div>
        <div className="muted-text" style={{ fontSize: 12 }}>
          {p.sku} · {p.category}
        </div>
      </td>
      <td>
        <input
          className="input-sm"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </td>
      <td>
        <input
          className="input-sm"
          style={{ width: 70 }}
          value={stock}
          onChange={(e) => setStock(e.target.value)}
        />
      </td>
      <td>
        <button
          className={"badge " + (p.active ? "badge-approved" : "badge-rejected")}
          style={{ border: 0, cursor: "pointer" }}
          onClick={toggleActive}
        >
          {p.active ? "Listed" : "Hidden"}
        </button>
      </td>
      <td className="num">
        <button className="btn btn-dark btn-sm" onClick={save} disabled={busy}>
          {busy ? "…" : "Save"}
        </button>
        {msg && (
          <span className="muted-text" style={{ marginLeft: 8, fontSize: 12 }}>
            {msg}
          </span>
        )}
      </td>
    </tr>
  );
}

export default function SupplierProductManager({
  products,
}: {
  products: SupplierProduct[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    sku: "",
    name: "",
    category: CATEGORIES[0],
    manufacturer: "",
    icon: "gear",
    price: "",
    unit: "each",
    etaDays: "3",
    stock: "0",
    description: "",
  });

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function addProduct(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/supplier/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        price: Number(form.price),
        etaDays: Number(form.etaDays),
        stock: Number(form.stock),
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not add product.");
      return;
    }
    setForm({
      sku: "", name: "", category: CATEGORIES[0], manufacturer: "",
      icon: "gear", price: "", unit: "each", etaDays: "3", stock: "0",
      description: "",
    });
    setShowForm(false);
    router.refresh();
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Your listings ({products.length})</h2>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowForm((s) => !s)}
        >
          {showForm ? "Cancel" : "+ Add a part"}
        </button>
      </div>

      {showForm && (
        <div className="card-body" style={{ borderBottom: "1px solid var(--line)" }}>
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={addProduct}>
            <div className="form-row two">
              <div>
                <label>SKU / part number</label>
                <input value={form.sku} onChange={(e) => set("sku", e.target.value)} required />
              </div>
              <div>
                <label>Part name</label>
                <input value={form.name} onChange={(e) => set("name", e.target.value)} required />
              </div>
            </div>
            <div className="form-row two">
              <div>
                <label>Category</label>
                <select value={form.category} onChange={(e) => set("category", e.target.value)}>
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Manufacturer</label>
                <input value={form.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} required />
              </div>
            </div>
            <div className="form-row two">
              <div>
                <label>Illustration</label>
                <select value={form.icon} onChange={(e) => set("icon", e.target.value)}>
                  {ICON_KEYS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Unit</label>
                <input value={form.unit} onChange={(e) => set("unit", e.target.value)} />
              </div>
            </div>
            <div className="form-row two">
              <div>
                <label>Price (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => set("price", e.target.value)}
                  required
                />
              </div>
              <div>
                <label>Lead time (days)</label>
                <input
                  type="number"
                  value={form.etaDays}
                  onChange={(e) => set("etaDays", e.target.value)}
                />
              </div>
            </div>
            <div className="form-row">
              <label>Stock on hand</label>
              <input
                type="number"
                value={form.stock}
                onChange={(e) => set("stock", e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>Description</label>
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Adding…" : "Add listing"}
            </button>
          </form>
        </div>
      )}

      {products.length === 0 ? (
        <div className="empty-block">
          <h3>No listings yet</h3>
          <p>Add your first part to appear in buyer search.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Part</th>
                <th>Price (USD)</th>
                <th>Stock</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <Row key={p.id} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card-body" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <span className="muted-text" style={{ fontSize: 12.5 }}>
          Total catalog value at list price:{" "}
          {formatCents(products.reduce((s, p) => s + p.priceCents * p.stock, 0))}
        </span>
      </div>
    </div>
  );
}

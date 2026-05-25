"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ICON_KEYS } from "./PartIcon";
import ImageManager from "./ImageManager";
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
  imageUrl?: string | null;
  weightLbs?: number | null;
  freightClass?: string | null;
  lengthIn?: number | null;
  widthIn?: number | null;
  heightIn?: number | null;
};

// NMFC freight classes that show up on industrial line cards. Listed in
// the form as a datalist so the supplier can type a custom value too.
const NMFC_CLASSES = [
  "50", "55", "60", "65", "70", "77.5", "85", "92.5",
  "100", "110", "125", "150", "175", "200", "250", "300", "400", "500",
];

const CATEGORIES = [
  "Transformers", "Switchgear & Breakers", "Protective Relays", "Conductors & Cable",
  "Line Hardware", "Metering", "Generators & ATS", "Solar & Inverters", "Energy Storage",
  "Grounding & Surge", "Controls & SCADA", "Safety & Arc-Flash",
];

function Row({ p }: { p: SupplierProduct }) {
  const router = useRouter();
  const [price, setPrice] = useState((p.priceCents / 100).toFixed(2));
  const [stock, setStock] = useState(String(p.stock));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [showImages, setShowImages] = useState(false);
  const [showFreight, setShowFreight] = useState(false);
  const [weight, setWeight] = useState(p.weightLbs != null ? String(p.weightLbs) : "");
  const [length, setLength] = useState(p.lengthIn != null ? String(p.lengthIn) : "");
  const [width, setWidth] = useState(p.widthIn != null ? String(p.widthIn) : "");
  const [height, setHeight] = useState(p.heightIn != null ? String(p.heightIn) : "");
  const [freightClass, setFreightClass] = useState(p.freightClass || "");
  const freightComplete =
    p.weightLbs != null && p.lengthIn != null && p.widthIn != null && p.heightIn != null;

  async function save() {
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/supplier/products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        price: Number(price),
        stock: Number(stock),
      }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg("Saved");
      router.refresh();
    } else {
      setMsg("Error");
    }
  }

  async function saveFreight() {
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/supplier/products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weightLbs: weight,
        lengthIn: length,
        widthIn: width,
        heightIn: height,
        freightClass,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg("Freight saved");
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
    <>
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
            type="button"
            className="link-btn"
            onClick={() => setShowImages((s) => !s)}
          >
            {showImages ? "Hide" : "Manage"}
          </button>
        </td>
        <td>
          <button
            type="button"
            className="link-btn"
            onClick={() => setShowFreight((s) => !s)}
            title={
              freightComplete
                ? "Real-rate freight enabled"
                : "Add weight + dimensions to enable real-rate freight quotes"
            }
          >
            {freightComplete ? "Set" : "Add"}
          </button>
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
      {showImages && (
        <tr>
          <td colSpan={7} style={{ background: "var(--bg)", padding: "16px 18px" }}>
            <ImageManager productId={p.id} />
          </td>
        </tr>
      )}
      {showFreight && (
        <tr>
          <td colSpan={7} style={{ background: "var(--bg)", padding: "16px 18px" }}>
            <div className="muted-text" style={{ fontSize: 12.5, marginBottom: 10 }}>
              Required for real-rate freight quotes from carriers. Leave
              blank to use the flat-rate fallback. Weight in pounds,
              dimensions in inches.
            </div>
            <div className="form-row" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
              <div>
                <label>Weight (lbs)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="e.g. 220"
                />
              </div>
              <div>
                <label>Length (in)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  placeholder="48"
                />
              </div>
              <div>
                <label>Width (in)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  placeholder="40"
                />
              </div>
              <div>
                <label>Height (in)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  placeholder="36"
                />
              </div>
              <div>
                <label>Freight class (NMFC)</label>
                <input
                  list={`nmfc-${p.id}`}
                  value={freightClass}
                  onChange={(e) => setFreightClass(e.target.value)}
                  placeholder="70"
                />
                <datalist id={`nmfc-${p.id}`}>
                  {NMFC_CLASSES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-dark btn-sm"
                onClick={saveFreight}
                disabled={busy}
              >
                {busy ? "Saving…" : "Save freight info"}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
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
    icon: "part",
    price: "",
    unit: "each",
    etaDays: "3",
    stock: "0",
    description: "",
    imageUrl: "",
    weightLbs: "",
    lengthIn: "",
    widthIn: "",
    heightIn: "",
    freightClass: "",
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
      icon: "part", price: "", unit: "each", etaDays: "3", stock: "0",
      description: "", imageUrl: "",
      weightLbs: "", lengthIn: "", widthIn: "", heightIn: "", freightClass: "",
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
              <label>Product photo URL <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--steel-light)" }}>(optional)</span></label>
              <input
                type="url"
                value={form.imageUrl}
                onChange={(e) => set("imageUrl", e.target.value)}
                placeholder="https://… link to a product photo"
              />
            </div>
            <div className="form-row">
              <label>Description</label>
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>

            <div
              className="form-row"
              style={{
                paddingTop: 12,
                borderTop: "1px dashed var(--line)",
                marginTop: 6,
              }}
            >
              <label>
                Freight info{" "}
                <span
                  style={{
                    textTransform: "none",
                    letterSpacing: 0,
                    color: "var(--steel-light)",
                  }}
                >
                  (optional, required for real-rate freight quotes)
                </span>
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  gap: 8,
                }}
              >
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="Weight (lbs)"
                  value={form.weightLbs}
                  onChange={(e) => set("weightLbs", e.target.value)}
                />
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="Length (in)"
                  value={form.lengthIn}
                  onChange={(e) => set("lengthIn", e.target.value)}
                />
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="Width (in)"
                  value={form.widthIn}
                  onChange={(e) => set("widthIn", e.target.value)}
                />
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder="Height (in)"
                  value={form.heightIn}
                  onChange={(e) => set("heightIn", e.target.value)}
                />
                <input
                  list="nmfc-add"
                  placeholder="NMFC class"
                  value={form.freightClass}
                  onChange={(e) => set("freightClass", e.target.value)}
                />
                <datalist id="nmfc-add">
                  {NMFC_CLASSES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
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
                <th>Photos</th>
                <th>Freight</th>
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

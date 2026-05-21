"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import ProductImage from "./ProductImage";
import { getCart, clearCart, type CartLine } from "@/lib/cart";
import { formatCents, feeFor } from "@/lib/money";

type LookupProduct = {
  sku: string;
  name: string;
  icon: string;
  imageUrl?: string | null;
  manufacturer: string;
  unit: string;
  priceCents: number;
  etaDays: number;
  stock: number;
  supplierName: string;
};

type Props = {
  user: { name: string; email: string } | null;
  paypalClientId: string;
};

export default function CheckoutClient({ user, paypalClientId }: Props) {
  const router = useRouter();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [products, setProducts] = useState<Record<string, LookupProduct>>({});
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [shipTo, setShipTo] = useState("");

  const [step, setStep] = useState<"form" | "pay">("form");
  const [orderId, setOrderId] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const cart = getCart();
    setLines(cart);
    if (cart.length === 0) {
      setLoading(false);
      return;
    }
    fetch("/api/products/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skus: cart.map((l) => l.sku) }),
    })
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, LookupProduct> = {};
        for (const p of data.products as LookupProduct[]) map[p.sku] = p;
        setProducts(map);
        setLoading(false);
      });
  }, []);

  const valid = lines.filter((l) => products[l.sku]);
  const subtotal = valid.reduce(
    (s, l) => s + products[l.sku].priceCents * l.qty,
    0
  );
  const fee = feeFor(subtotal);
  const total = subtotal + fee;
  const maxEta = valid.reduce(
    (m, l) => Math.max(m, products[l.sku].etaDays),
    0
  );

  async function createOrder() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: valid.map((l) => ({ sku: l.sku, qty: l.qty })),
        buyerName: name,
        buyerEmail: email,
        shipTo,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not create your order.");
      return;
    }
    setOrderId(data.orderId);
    setReference(data.reference);
    setStep("pay");
  }

  function onFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !shipTo.trim()) {
      setError("Please fill in your name, email and delivery address.");
      return;
    }
    createOrder();
  }

  const finishOrder = useCallback(() => {
    clearCart();
    router.push(`/orders/${orderId}`);
  }, [orderId, router]);

  async function payDemo() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/orders/${orderId}/pay`, { method: "POST" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Payment failed.");
      setBusy(false);
      return;
    }
    finishOrder();
  }

  if (loading) return <p className="muted-text">Loading checkout…</p>;

  if (valid.length === 0) {
    return (
      <div className="empty-block">
        <h3>Nothing to check out</h3>
        <p>Your cart is empty.</p>
        <div style={{ marginTop: 16 }}>
          <Link className="btn btn-primary" href="/catalog">
            Browse catalog
          </Link>
        </div>
      </div>
    );
  }

  const summary = (
    <div className="card">
      <div className="card-body">
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
          Order summary
        </h2>
        {valid.map((l) => {
          const p = products[l.sku];
          return (
            <div className="summary-item" key={l.sku}>
              <div className="si-thumb">
                <ProductImage imageUrl={p.imageUrl} icon={p.icon} name={p.name} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</div>
                <div className="muted-text" style={{ fontSize: 12 }}>
                  Qty {l.qty} × {formatCents(p.priceCents)}
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                {formatCents(p.priceCents * l.qty)}
              </div>
            </div>
          );
        })}
        <div className="summary-line">
          <span>Subtotal</span>
          <span>{formatCents(subtotal)}</span>
        </div>
        <div className="summary-line">
          <span>PartsPort fee &amp; delivery (4%)</span>
          <span style={{ color: "var(--amber-dark)" }}>{formatCents(fee)}</span>
        </div>
        <div className="summary-line total">
          <span>Total</span>
          <span>{formatCents(total)}</span>
        </div>
        <p className="muted-text" style={{ fontSize: 12.5, marginTop: 8 }}>
          Estimated delivery in {maxEta} business day{maxEta > 1 ? "s" : ""}.
        </p>
      </div>
    </div>
  );

  return (
    <div className="checkout-grid">
      <div>
        {error && <div className="alert alert-error">{error}</div>}

        {step === "form" && (
          <div className="card">
            <div className="card-head">
              <h2>Delivery details</h2>
            </div>
            <div className="card-body">
              <form onSubmit={onFormSubmit}>
                <div className="form-row two">
                  <div>
                    <label htmlFor="cname">Full name</label>
                    <input
                      id="cname"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="cemail">Email</label>
                    <input
                      id="cemail"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="cship">Delivery address</label>
                  <textarea
                    id="cship"
                    value={shipTo}
                    onChange={(e) => setShipTo(e.target.value)}
                    placeholder="Company, street, city, state, ZIP"
                    required
                  />
                </div>
                <button className="btn btn-primary btn-block" disabled={busy}>
                  {busy ? "Creating order…" : "Continue to payment"}
                </button>
              </form>
            </div>
          </div>
        )}

        {step === "pay" && (
          <div className="card">
            <div className="card-head">
              <h2>Payment · Order {reference}</h2>
            </div>
            <div className="card-body">
              <div className="pay-note">
                PartsPort collects payment, then releases funds to the supplier
                on dispatch. The 4% service fee is included in the total below.
              </div>
              {paypalClientId ? (
                <PayPalScriptProvider
                  options={{ clientId: paypalClientId, currency: "USD" }}
                >
                  <PayPalButtons
                    style={{ layout: "vertical", color: "gold", shape: "rect" }}
                    createOrder={async () => {
                      const res = await fetch("/api/paypal/create-order", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ orderId }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error);
                      return data.paypalOrderId as string;
                    }}
                    onApprove={async () => {
                      const res = await fetch("/api/paypal/capture", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ orderId }),
                      });
                      if (!res.ok) {
                        setError("Payment could not be captured.");
                        return;
                      }
                      finishOrder();
                    }}
                    onError={() => setError("PayPal checkout failed. Try again.")}
                  />
                </PayPalScriptProvider>
              ) : (
                <>
                  <div className="alert alert-info">
                    Instant order settlement is enabled for this environment.
                    Connect a PayPal account to accept live card and PayPal
                    payments.
                  </div>
                  <button
                    className="btn btn-primary btn-block"
                    onClick={payDemo}
                    disabled={busy}
                  >
                    {busy ? "Processing…" : `Place order · ${formatCents(total)}`}
                  </button>
                </>
              )}
              <button
                className="btn btn-ghost btn-block"
                style={{ marginTop: 9 }}
                onClick={() => setStep("form")}
                disabled={busy}
              >
                ← Back to details
              </button>
            </div>
          </div>
        )}
      </div>

      {summary}
    </div>
  );
}

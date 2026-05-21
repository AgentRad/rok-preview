"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import PartIcon from "./PartIcon";
import { getCart, setQty, onCartChange, type CartLine } from "@/lib/cart";
import { formatCents, feeFor } from "@/lib/money";

type LookupProduct = {
  sku: string;
  name: string;
  icon: string;
  manufacturer: string;
  unit: string;
  priceCents: number;
  etaDays: number;
  stock: number;
  supplierName: string;
};

export default function CartClient() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [products, setProducts] = useState<Record<string, LookupProduct>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const cart = getCart();
    setLines(cart);
    if (cart.length === 0) {
      setProducts({});
      setLoading(false);
      return;
    }
    const res = await fetch("/api/products/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skus: cart.map((l) => l.sku) }),
    });
    const data = await res.json();
    const map: Record<string, LookupProduct> = {};
    for (const p of data.products as LookupProduct[]) map[p.sku] = p;
    setProducts(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    return onCartChange(refresh);
  }, [refresh]);

  const valid = lines.filter((l) => products[l.sku]);
  const subtotal = valid.reduce(
    (s, l) => s + products[l.sku].priceCents * l.qty,
    0
  );
  const fee = feeFor(subtotal);

  if (loading) {
    return <p className="muted-text">Loading your cart…</p>;
  }

  if (valid.length === 0) {
    return (
      <div className="empty-block">
        <h3>Your cart is empty</h3>
        <p>Browse the catalog and add the parts you need.</p>
        <div style={{ marginTop: 16 }}>
          <Link className="btn btn-primary" href="/catalog">
            Browse catalog
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-grid">
      <div>
        {valid.map((l) => {
          const p = products[l.sku];
          return (
            <div className="cart-line" key={l.sku}>
              <div className="cl-thumb">
                <PartIcon icon={p.icon} />
              </div>
              <div className="cl-main">
                <div className="cl-mfr">{p.manufacturer}</div>
                <div className="cl-name">
                  <Link href={`/product/${p.sku}`}>{p.name}</Link>
                </div>
                <div className="muted-text" style={{ fontSize: 12.5 }}>
                  {formatCents(p.priceCents)} / {p.unit} · {p.supplierName} ·{" "}
                  {p.stock > 0
                    ? `delivery in ${p.etaDays} day${p.etaDays > 1 ? "s" : ""}`
                    : "backorder"}
                </div>
                <div className="ci-controls" style={{ marginTop: 8 }}>
                  <div className="qty-stepper">
                    <button onClick={() => setQty(l.sku, l.qty - 1)} aria-label="Decrease">
                      −
                    </button>
                    <span>{l.qty}</span>
                    <button onClick={() => setQty(l.sku, l.qty + 1)} aria-label="Increase">
                      +
                    </button>
                  </div>
                  <button className="ci-remove" onClick={() => setQty(l.sku, 0)}>
                    Remove
                  </button>
                </div>
              </div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>
                {formatCents(p.priceCents * l.qty)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-body">
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
            Order summary
          </h2>
          <div className="summary-line">
            <span>Subtotal ({valid.length} item{valid.length > 1 ? "s" : ""})</span>
            <span>{formatCents(subtotal)}</span>
          </div>
          <div className="summary-line">
            <span>PartsPort fee &amp; delivery (4%)</span>
            <span style={{ color: "var(--amber-dark)" }}>{formatCents(fee)}</span>
          </div>
          <div className="summary-line total">
            <span>Order total</span>
            <span>{formatCents(subtotal + fee)}</span>
          </div>
          <Link
            className="btn btn-primary btn-block"
            href="/checkout"
            style={{ marginTop: 14 }}
          >
            Proceed to checkout
          </Link>
          <Link
            className="btn btn-ghost btn-block"
            href="/catalog"
            style={{ marginTop: 9 }}
          >
            Continue shopping
          </Link>
        </div>
      </div>
    </div>
  );
}

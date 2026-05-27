"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import ProductImage from "./ProductImage";
import { primaryImageUrl } from "@/lib/product-images";
import { getCart, setQty, onCartChange, type CartLine } from "@/lib/cart";
import { formatCents } from "@/lib/money";
import { computeOrderTotals } from "@/lib/order-totals";

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
  quoteOnly: boolean;
  supplierName: string;
};

export default function CartClient() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [products, setProducts] = useState<Record<string, LookupProduct>>({});
  // Start loading=false so SSR / no-JS render shows the noscript empty-state
  // cleanly. The effect below flips loading=true only after hydration when
  // we actually start fetching. Pre-hydration: empty cart UI, which matches
  // the noscript fallback message.
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const cart = getCart();
    setLines(cart);
    if (cart.length === 0) {
      setProducts({});
      setLoading(false);
      return;
    }
    // Flip to loading only when there's actually a fetch in flight, so the
    // user with items in localStorage gets a real loading state while we
    // fetch product metadata (instead of briefly seeing the empty-cart UI).
    setLoading(true);
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
  const totals = computeOrderTotals(
    valid.map((l) => ({
      unitPriceCents: products[l.sku].priceCents,
      qty: l.qty,
      quoteOnly: products[l.sku].quoteOnly,
    }))
  );
  const { subtotalCents: subtotal, freightCents, freight, totalCents } = totals;

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

  // PLH-3g Phase 2: group cart by supplier. Preserve first-seen ordering so
  // the UI stays stable as users add items.
  const groups: { supplierName: string; lines: CartLine[]; subtotalCents: number }[] = [];
  const groupIndex = new Map<string, number>();
  for (const l of valid) {
    const p = products[l.sku];
    const name = p.supplierName || "Unknown supplier";
    let idx = groupIndex.get(name);
    if (idx === undefined) {
      idx = groups.length;
      groupIndex.set(name, idx);
      groups.push({ supplierName: name, lines: [], subtotalCents: 0 });
    }
    groups[idx].lines.push(l);
    groups[idx].subtotalCents += p.priceCents * l.qty;
  }
  const multiSupplier = groups.length > 1;

  return (
    <div className="checkout-grid">
      <div>
        {groups.map((g) => (
          <div key={g.supplierName} style={{ marginBottom: 18 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                padding: "8px 0",
                borderBottom: "1px solid var(--border)",
                marginBottom: 8,
              }}
            >
              <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>
                {g.supplierName}
              </h3>
              <span className="muted-text" style={{ fontSize: 12.5 }}>
                Subtotal {formatCents(g.subtotalCents)}
              </span>
            </div>
            {g.lines.map((l) => {
              const p = products[l.sku];
              return (
                <div className="cart-line" key={l.sku}>
                  <div className="cl-thumb">
                    <ProductImage imageUrl={primaryImageUrl(p)} icon={p.icon} name={p.name} />
                  </div>
                  <div className="cl-main">
                    <div className="cl-mfr">{p.manufacturer}</div>
                    <div className="cl-name">
                      <Link href={`/product/${p.sku}`}>{p.name}</Link>
                    </div>
                    <div className="muted-text" style={{ fontSize: 12.5 }}>
                      {formatCents(p.priceCents)} / {p.unit} ·{" "}
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
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    {formatCents(p.priceCents * l.qty)}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
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
            <span>
              Freight
              <span className="muted-text" style={{ fontSize: 11, marginLeft: 6 }}>
                {freight.label}
              </span>
            </span>
            <span>{freightCents > 0 ? formatCents(freightCents) : freight.basis === "FREIGHT_QUOTED" ? "TBD" : formatCents(0)}</span>
          </div>
          <div className="summary-line">
            <span>Sales tax</span>
            <span>{formatCents(0)}</span>
          </div>
          <div className="summary-line total">
            <span>Order total</span>
            <span>{formatCents(totalCents)}</span>
          </div>
          <p className="muted-text" style={{ fontSize: 11.5, marginTop: 6 }}>
            Sales tax is calculated at checkout based on ship-to address.
            {freight.basis === "FREIGHT_QUOTED" &&
              " This order includes large equipment; the supplier will quote LTL freight directly after the order is placed."}
          </p>
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

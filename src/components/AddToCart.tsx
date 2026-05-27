"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addToCart } from "@/lib/cart";

export default function AddToCart({
  sku,
  inStock,
  supplierId,
  supplierName,
}: {
  sku: string;
  inStock: boolean;
  supplierId: string;
  supplierName: string;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  function tryAdd(action: "add" | "buy") {
    addToCart(sku, qty, { id: supplierId, name: supplierName });
    if (action === "buy") router.push("/checkout");
    else setAdded(true);
  }

  return (
    <div>
      {!inStock && (
        <p className="muted-text" style={{ marginBottom: 12, fontSize: 12.5 }}>
          This part is on backorder. Use the request-a-quote flow on the
          supplier page for a confirmed ETA.
        </p>
      )}
      <div className="qty-row">
        <span style={{ fontSize: 14, fontWeight: 600 }}>Qty</span>
        <div className="qty-stepper">
          <button
            type="button"
            aria-label="Decrease"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={!inStock}
          >
            −
          </button>
          <span>{qty}</span>
          <button
            type="button"
            aria-label="Increase"
            onClick={() => setQty((q) => q + 1)}
            disabled={!inStock}
          >
            +
          </button>
        </div>
      </div>
      <button
        className="btn btn-primary btn-block"
        onClick={() => tryAdd("add")}
        disabled={!inStock}
      >
        {inStock ? "Add to cart" : "Out of stock"}
      </button>
      <button
        className="btn btn-ghost btn-block"
        style={{ marginTop: 9 }}
        onClick={() => tryAdd("buy")}
        disabled={!inStock}
      >
        {inStock ? "Buy now" : "Backorder unavailable"}
      </button>
      {added && (
        <div className="alert alert-ok" style={{ marginTop: 12, marginBottom: 0 }}>
          ✓ Added to cart.{" "}
          <Link href="/cart" style={{ fontWeight: 700, color: "inherit" }}>
            View cart →
          </Link>
        </div>
      )}
    </div>
  );
}

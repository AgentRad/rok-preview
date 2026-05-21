"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addToCart } from "@/lib/cart";

export default function AddToCart({
  sku,
  inStock,
}: {
  sku: string;
  inStock: boolean;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  function add() {
    addToCart(sku, qty);
    setAdded(true);
  }

  function buyNow() {
    addToCart(sku, qty);
    router.push("/checkout");
  }

  return (
    <div>
      <div className="qty-row">
        <span style={{ fontSize: 14, fontWeight: 600 }}>Qty</span>
        <div className="qty-stepper">
          <button type="button" aria-label="Decrease" onClick={() => setQty((q) => Math.max(1, q - 1))}>
            −
          </button>
          <span>{qty}</span>
          <button type="button" aria-label="Increase" onClick={() => setQty((q) => q + 1)}>
            +
          </button>
        </div>
      </div>
      <button className="btn btn-primary btn-block" onClick={add}>
        Add to cart
      </button>
      <button
        className="btn btn-ghost btn-block"
        style={{ marginTop: 9 }}
        onClick={buyNow}
      >
        Buy now
      </button>
      {added && (
        <div className="alert alert-ok" style={{ marginTop: 12, marginBottom: 0 }}>
          ✓ Added to cart.{" "}
          <Link href="/cart" style={{ fontWeight: 700, color: "inherit" }}>
            View cart →
          </Link>
        </div>
      )}
      {!inStock && (
        <p className="muted-text" style={{ marginTop: 10, fontSize: 12.5 }}>
          This part is on backorder. Delivery takes longer than the listed ETA.
        </p>
      )}
    </div>
  );
}

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

  function handleAdd() {
    addToCart(sku, qty, { id: supplierId, name: supplierName });
    setAdded(true);
  }

  function handleBuyNow(e: React.MouseEvent) {
    e.preventDefault();
    addToCart(sku, qty, { id: supplierId, name: supplierName });
    router.push("/checkout");
  }

  return (
    <div>
      {!inStock && (
        <p className="muted-text" style={{ marginBottom: 12, fontSize: 12.5 }}>
          This part is on backorder. Need it sooner?{" "}
          <a
            href={`mailto:rad@agentgaming.gg?subject=${encodeURIComponent(
              `RFQ for backordered SKU ${sku}`
            )}&body=${encodeURIComponent(
              `I'd like a quote for SKU ${sku} (currently on backorder).\n\nQuantity:\nDelivery location:\nRequired by:\nNotes:\n`
            )}`}
            style={{ color: "var(--blue)", fontWeight: 600 }}
          >
            Request a quote for this part instead
          </a>{" "}
          and a supplier will confirm an ETA.
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
        onClick={handleAdd}
        disabled={!inStock}
      >
        {inStock ? "Add to cart" : "Out of stock"}
      </button>
      {inStock && (
        <div style={{ marginTop: 8, fontSize: 12.5 }}>
          <a
            href="/checkout"
            onClick={handleBuyNow}
            className="muted-text"
            style={{ textDecoration: "none" }}
          >
            Or skip cart and check out now →
          </a>
        </div>
      )}
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

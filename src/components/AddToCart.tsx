"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addToCart, clearCart, DifferentSupplierError } from "@/lib/cart";

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
  const [conflict, setConflict] = useState<{
    existingSupplierName: string;
    pendingAction: "add" | "buy";
  } | null>(null);

  function tryAdd(action: "add" | "buy") {
    try {
      addToCart(sku, qty, { id: supplierId, name: supplierName });
      if (action === "buy") router.push("/checkout");
      else setAdded(true);
    } catch (err) {
      if (err instanceof DifferentSupplierError) {
        setConflict({
          existingSupplierName: err.existingSupplierName,
          pendingAction: action,
        });
        return;
      }
      throw err;
    }
  }

  function confirmReplaceCart() {
    if (!conflict) return;
    const action = conflict.pendingAction;
    clearCart();
    addToCart(sku, qty, { id: supplierId, name: supplierName });
    setConflict(null);
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
      {conflict && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="diff-supplier-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setConflict(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 460, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-body">
              <h2
                id="diff-supplier-title"
                style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}
              >
                Start a new cart?
              </h2>
              <p style={{ fontSize: 14, lineHeight: 1.5 }}>
                Your cart contains items from {conflict.existingSupplierName}.
                PartsPort routes shipments and payments per supplier, so each
                order can only contain items from one supplier. Start a new
                cart?
              </p>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 16,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  className="btn btn-ghost"
                  onClick={() => setConflict(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={confirmReplaceCart}
                >
                  Start a new cart
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

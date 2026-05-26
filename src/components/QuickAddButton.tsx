"use client";

import { useState } from "react";
import { addToCart, clearCart, DifferentSupplierError } from "@/lib/cart";

export default function QuickAddButton({
  sku,
  quoteOnly,
  supplierId,
  supplierName,
}: {
  sku: string;
  quoteOnly: boolean;
  supplierId: string;
  supplierName: string;
}) {
  const [added, setAdded] = useState(false);
  const [conflict, setConflict] = useState<{
    existingSupplierName: string;
  } | null>(null);

  if (quoteOnly) {
    return <span className="quick-add-tag">Request quote</span>;
  }

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      addToCart(sku, 1, { id: supplierId, name: supplierName });
      setAdded(true);
      setTimeout(() => setAdded(false), 1800);
    } catch (err) {
      if (err instanceof DifferentSupplierError) {
        setConflict({ existingSupplierName: err.existingSupplierName });
        return;
      }
      throw err;
    }
  }

  function confirmReplaceCart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    clearCart();
    addToCart(sku, 1, { id: supplierId, name: supplierName });
    setConflict(null);
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  function cancelConflict(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setConflict(null);
  }

  return (
    <>
      <button type="button" className="quick-add-btn" onClick={handleClick}>
        {added ? "✓ Added" : "+ Add to cart"}
      </button>
      {conflict && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qa-diff-supplier-title"
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
          onClick={cancelConflict}
        >
          <div
            className="card"
            style={{ maxWidth: 460, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-body">
              <h2
                id="qa-diff-supplier-title"
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
                <button className="btn btn-ghost" onClick={cancelConflict}>
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
    </>
  );
}

"use client";

import { useState } from "react";
import { addToCart } from "@/lib/cart";

export default function QuickAddButton({
  sku,
  quoteOnly,
}: {
  sku: string;
  quoteOnly: boolean;
}) {
  const [added, setAdded] = useState(false);

  if (quoteOnly) {
    return (
      <span className="quick-add-tag">Request quote</span>
    );
  }

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    addToCart(sku, 1);
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  return (
    <button
      type="button"
      className="quick-add-btn"
      onClick={handleClick}
    >
      {added ? "✓ Added" : "+ Add to cart"}
    </button>
  );
}

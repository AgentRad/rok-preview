"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addToCart } from "@/lib/cart";

export default function ReorderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reorder() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/orders/${orderId}/reorder`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not reorder.");
        return;
      }
      const items = (data.items || []) as { sku: string; qty: number }[];
      for (const i of items) addToCart(i.sku, i.qty);

      const skipped = (data.skipped || []) as Array<{
        sku: string;
        name: string;
        reason: string;
      }>;
      if (items.length === 0) {
        alert(
          skipped.length > 0
            ? `Nothing from this order is available to reorder. ${skipped[0].reason}.`
            : "Nothing from this order is available to reorder."
        );
        return;
      }
      if (skipped.length > 0) {
        const lines = skipped
          .map((s) => `- ${s.name} (${s.sku}): ${s.reason}`)
          .join("\n");
        alert(
          `Added ${items.length} item${items.length === 1 ? "" : "s"} to your cart. Skipped:\n\n${lines}`
        );
      }
      router.push("/cart");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="link-btn"
        onClick={reorder}
        disabled={busy}
        style={{ fontWeight: 600 }}
      >
        {busy ? "Adding to cart…" : "Reorder"}
      </button>
      {error && (
        <span className="muted-text" style={{ color: "var(--red)", marginLeft: 8, fontSize: 12 }}>
          {error}
        </span>
      )}
    </>
  );
}

import AttentionFeed from "@/components/AttentionFeed";
import type { getSupplierAttention } from "@/lib/attention";

type Items = Awaited<ReturnType<typeof getSupplierAttention>>;

// PLH-3l P2: extracted from /supplier/page.tsx.
export default function AttentionPanel({ items }: { items: Items }) {
  return (
    <AttentionFeed
      items={items}
      emptyTitle="Caught up."
      emptyBody="No RFQs waiting, no orders to ship, no low stock right now. Use this calm moment to add a new SKU or tidy up your catalog."
      emptyAction={{ label: "Manage listings", href: "/supplier/products" }}
    />
  );
}

import AttentionFeed from "@/components/AttentionFeed";
import type { getSupplierAttention } from "@/lib/attention";

type Items = Awaited<ReturnType<typeof getSupplierAttention>>;

// PLH-3l P2: extracted from /supplier/page.tsx.
// PLH-3u P2: caught-up state names the next likely action instead of leaving
// the supplier on a passive "tidy up" prompt.
export default function AttentionPanel({
  items,
  nextAction,
}: {
  items: Items;
  nextAction?: { label: string; href: string };
}) {
  const action = nextAction || {
    label: "Browse your catalog",
    href: "/supplier/products",
  };
  return (
    <AttentionFeed
      items={items}
      emptyTitle="All caught up."
      emptyBody={`Next likely action: ${action.label}.`}
      emptyAction={action}
    />
  );
}

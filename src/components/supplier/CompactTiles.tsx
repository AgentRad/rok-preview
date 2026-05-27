import Link from "next/link";
import { formatCents } from "@/lib/money";

// PLH-3l P6: compact 1-line dashboard tiles linking to /supplier/quotes,
// /supplier/orders (account/orders fallback), and /supplier/payouts.
export type CompactTilesProps = {
  openQuotes: number;
  oldestQuoteDays: number | null;
  shipQueueCount: number;
  payoutsDueCents: number;
  showQuotes: boolean;
  showOrders: boolean;
  showPayouts: boolean;
  ordersHref: string;
};

function Tile({
  href,
  icon,
  body,
  cta,
}: {
  href: string;
  icon: string;
  body: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 18px",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-sm)",
        background: "var(--surface)",
        color: "var(--ink)",
        textDecoration: "none",
        fontSize: 14,
      }}
    >
      <span aria-hidden style={{ fontSize: 18 }}>
        {icon}
      </span>
      <span style={{ flex: 1 }}>{body}</span>
      <span
        className="muted-text"
        style={{ fontSize: 12.5, whiteSpace: "nowrap" }}
      >
        {cta} →
      </span>
    </Link>
  );
}

export default function CompactTiles(props: CompactTilesProps) {
  const {
    openQuotes,
    oldestQuoteDays,
    shipQueueCount,
    payoutsDueCents,
    showQuotes,
    showOrders,
    showPayouts,
    ordersHref,
  } = props;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 12,
        margin: "20px 0",
      }}
    >
      {showQuotes && openQuotes > 0 && (
        <Tile
          href="/supplier/quotes"
          icon="📋"
          body={
            openQuotes === 1
              ? `1 open RFQ${oldestQuoteDays != null ? ` · oldest ${oldestQuoteDays} day${oldestQuoteDays === 1 ? "" : "s"}` : ""}`
              : `${openQuotes} open RFQs${oldestQuoteDays != null ? ` · oldest ${oldestQuoteDays} day${oldestQuoteDays === 1 ? "" : "s"}` : ""}`
          }
          cta="View all"
        />
      )}
      {showOrders && shipQueueCount > 0 && (
        <Tile
          href={ordersHref}
          icon="📦"
          body={
            shipQueueCount === 1
              ? "1 paid order awaiting ship"
              : `${shipQueueCount} paid orders awaiting ship`
          }
          cta="View orders"
        />
      )}
      {showPayouts && payoutsDueCents > 0 && (
        <Tile
          href="/supplier/payouts"
          icon="💰"
          body={`${formatCents(payoutsDueCents)} in payouts due`}
          cta="View payouts"
        />
      )}
    </div>
  );
}

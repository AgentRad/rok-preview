import { formatCents } from "@/lib/money";

// PLH-3l P2: extracted from /supplier/page.tsx kpi-grid.
export default function StatsRow({
  activeListings,
  totalListings,
  unitsInStock,
  ordersCount,
  revenueCents,
}: {
  activeListings: number;
  totalListings: number;
  unitsInStock: number;
  ordersCount: number;
  revenueCents: number;
}) {
  return (
    <div className="kpi-grid">
      <div className="kpi">
        <div className="k-label">Active listings</div>
        <div className="k-value">{activeListings}</div>
        <div className="k-foot">{totalListings} total</div>
      </div>
      <div className="kpi">
        <div className="k-label">Units in stock</div>
        <div className="k-value">{unitsInStock.toLocaleString()}</div>
        <div className="k-foot">across all listings</div>
      </div>
      <div className="kpi">
        <div className="k-label">Orders</div>
        <div className="k-value">{ordersCount}</div>
        <div className="k-foot">paid &amp; fulfilled</div>
      </div>
      <div className="kpi">
        <div className="k-label">Revenue</div>
        <div className="k-value">{formatCents(revenueCents)}</div>
        <div className="k-foot">your share, fees excluded</div>
      </div>
    </div>
  );
}

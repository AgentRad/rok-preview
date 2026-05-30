import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getProfitDashboard } from "@/lib/profit";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

const CHART_HEIGHT = 140;
const CHART_BAR_GAP = 4;

function TrendChart({
  points,
}: {
  points: { day: string; gmvCents: number }[];
}) {
  if (points.length === 0) {
    return (
      <div className="muted-text" style={{ fontSize: 13 }}>
        No paid orders in the last 30 days.
      </div>
    );
  }
  const max = Math.max(...points.map((p) => p.gmvCents), 1);
  return (
    <div className="profit-chart" role="img" aria-label="Daily GMV trend">
      <div className="profit-chart-bars">
        {points.map((p) => {
          const h = Math.max(2, Math.round((p.gmvCents / max) * CHART_HEIGHT));
          return (
            <div
              key={p.day}
              className="profit-chart-bar"
              style={{ height: `${h}px` }}
              title={`${p.day}: ${formatCents(p.gmvCents)}`}
            />
          );
        })}
      </div>
      <div className="profit-chart-axis">
        <span>{points[0].day}</span>
        <span>{points[points.length - 1].day}</span>
      </div>
    </div>
  );
}

export default async function ProfitDashboard() {
  await requireRole("ADMIN");
  const data = await getProfitDashboard();
  const month = new Date().toISOString().slice(0, 7);
  return (
    <>
      <main id="main" className="app-page">
        <div className="page-pad">
          <h1 className="page-title">Profit dashboard</h1>
          <p className="page-sub">
            Marketplace economics, month to date and year to date.
            Numbers exclude PENDING (unpaid) orders. Stripe processing
            cost is estimated at card rates (2.9% + 30c) and is
            directional, not a books-of-record number.{" "}
            <Link
              href={`/api/admin/tax-report.csv?period=${month}`}
              style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
            >
              Export tax report (CSV)
            </Link>{" "}
            ·{" "}
            <Link
              href="/admin"
              style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
            >
              Back to admin
            </Link>
          </p>

          {/* MTD KPIs */}
          <h2 style={{ marginTop: 24 }}>Month to date</h2>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="k-label">GMV (gross)</div>
              <div className="k-value">{formatCents(data.mtd.gmvCents)}</div>
              <div className="k-foot">
                {data.mtd.paidOrderCount} paid order
                {data.mtd.paidOrderCount === 1 ? "" : "s"}
              </div>
            </div>
            <div className="kpi">
              <div className="k-label">GMV (net of refunds)</div>
              <div className="k-value">{formatCents(data.mtd.netGmvCents)}</div>
              <div className="k-foot">after {formatCents(data.mtd.refundCents)} refunded</div>
            </div>
            <div className="kpi">
              <div className="k-label">Fee revenue (gross)</div>
              <div className="k-value">{formatCents(data.mtd.feeRevenueCents)}</div>
              <div className="k-foot">marketplace fees billed</div>
            </div>
            <div className="kpi">
              <div className="k-label">Fee revenue (net)</div>
              <div className="k-value">{formatCents(data.mtd.netFeeRevenueCents)}</div>
              <div className="k-foot">after pro-rata refund offsets</div>
            </div>
            <div className="kpi">
              <div className="k-label">Stripe cost (est.)</div>
              <div className="k-value">
                {formatCents(data.mtd.stripeCostEstimateCents)}
              </div>
              <div className="k-foot">2.9% + 30c per charge</div>
            </div>
            <div className="kpi">
              <div className="k-label">Net</div>
              <div className="k-value">{formatCents(data.mtd.netCents)}</div>
              <div className="k-foot">fee revenue - Stripe cost</div>
            </div>
            <div className="kpi">
              <div className="k-label">Payouts</div>
              <div className="k-value">{formatCents(data.mtd.payoutCents)}</div>
              <div className="k-foot">to suppliers</div>
            </div>
            <div className="kpi">
              <div className="k-label">Refunds</div>
              <div className="k-value">{formatCents(data.mtd.refundCents)}</div>
              <div className="k-foot">issued to buyers</div>
            </div>
          </div>

          {/* YTD KPIs */}
          <h2 style={{ marginTop: 24 }}>Year to date</h2>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="k-label">GMV</div>
              <div className="k-value">{formatCents(data.ytd.gmvCents)}</div>
              <div className="k-foot">{data.ytd.paidOrderCount} orders</div>
            </div>
            <div className="kpi">
              <div className="k-label">Fee revenue</div>
              <div className="k-value">{formatCents(data.ytd.feeRevenueCents)}</div>
            </div>
            <div className="kpi">
              <div className="k-label">Net</div>
              <div className="k-value">{formatCents(data.ytd.netCents)}</div>
              <div className="k-foot">after est. Stripe cost</div>
            </div>
            <div className="kpi">
              <div className="k-label">Refunds</div>
              <div className="k-value">{formatCents(data.ytd.refundCents)}</div>
            </div>
          </div>

          {/* Daily trend */}
          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-head">
              <h2>GMV trend, last 30 days</h2>
            </div>
            <div className="card-body">
              <TrendChart
                points={data.daily.map((d) => ({
                  day: d.day,
                  gmvCents: d.gmvCents,
                }))}
              />
            </div>
          </div>

          {/* Per-supplier */}
          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-head">
              <h2>Per supplier (MTD)</h2>
            </div>
            {data.supplierBreakdown.length === 0 ? (
              <div className="empty-block">
                <h3>No supplier activity this month</h3>
                <p>Once a paid order lands the supplier shows up here.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th className="num">Volume</th>
                      <th className="num">Fee revenue</th>
                      <th className="num">Supplier earnings</th>
                      <th className="num">Reserve held</th>
                      <th className="num">Owed to platform</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.supplierBreakdown.map((s) => (
                      <tr key={s.supplierId}>
                        <td style={{ fontWeight: 600 }}>{s.supplierName}</td>
                        <td className="num">{formatCents(s.volumeCents)}</td>
                        <td className="num">{formatCents(s.feeRevenueCents)}</td>
                        <td className="num">
                          {formatCents(s.supplierEarningsCents)}
                        </td>
                        <td className="num">
                          {formatCents(s.reserveBalanceCents)}
                        </td>
                        <td
                          className="num"
                          style={
                            s.owedToPlatformCents > 0
                              ? { color: "var(--amber, #b45309)", fontWeight: 600 }
                              : undefined
                          }
                        >
                          {formatCents(s.owedToPlatformCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Per-category */}
          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-head">
              <h2>Per category (MTD)</h2>
            </div>
            {data.categoryBreakdown.length === 0 ? (
              <div className="empty-block">
                <h3>No category activity this month</h3>
                <p>Pick up after the first paid order lands.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th className="num">Orders</th>
                      <th className="num">Volume</th>
                      <th className="num">Fee revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.categoryBreakdown.map((c) => (
                      <tr key={c.category}>
                        <td style={{ fontWeight: 600 }}>{c.category}</td>
                        <td className="num">{c.orderCount}</td>
                        <td className="num">{formatCents(c.volumeCents)}</td>
                        <td className="num">{formatCents(c.feeRevenueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import Link from "next/link";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Polish 12 commit 5 (II): per-supplier health dashboard. Admin-only.
 *
 * Metrics per supplier:
 *   - stock count (sum of Product.stock across active products)
 *   - avg days-to-ship (last 30 days of shipped orders)
 *   - order volume 30 / 90 / YTD
 *   - refund rate (last 90 days)
 *   - reserveBalanceCents + owedToPlatformCents
 *   - last activity (most recent order create)
 *
 * Alerts flagged inline:
 *   refund rate > 5%, avg days-to-ship > 7, owed > 0, inactive > 30d.
 */
export default async function SupplierHealthPage() {
  await requireRole("ADMIN");

  const now = Date.now();
  const D30 = now - 30 * 86400_000;
  const D90 = now - 90 * 86400_000;
  const YTD_START = new Date(new Date().getFullYear(), 0, 1).getTime();

  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
    include: {
      products: { select: { stock: true, active: true } },
    },
  });

  // PLH-3a B2: bound the orderItems query to the YTD window. All in-process
  // buckets (D30 / D90 / YTD) live inside YTD anyway, so pulling rows older
  // than Jan 1 of the current year was pure waste. As marketplace volume
  // grows this stops the page from scanning the full lifetime of every
  // historical line item on each load.
  const items = await prisma.orderItem.findMany({
    where: { order: { createdAt: { gte: new Date(YTD_START) } } },
    include: {
      order: { select: { id: true, status: true, createdAt: true,
        refundedCents: true, totalCents: true, paidAt: true,
        shippedAt: true, shipmentStage: true } },
      product: { select: { supplierId: true } },
    },
  });

  type Metric = {
    id: string;
    name: string;
    stock: number;
    daysToShip: number | null;
    orders30: number;
    orders90: number;
    ordersYTD: number;
    refundRate: number;
    refundedTotal: number;
    grossTotal: number;
    reserve: number;
    owed: number;
    lastActivity: Date | null;
    alerts: string[];
  };

  const metricsBySupplier = new Map<string, Metric>();
  for (const s of suppliers) {
    metricsBySupplier.set(s.id, {
      id: s.id,
      name: s.name,
      stock: s.products
        .filter((p) => p.active)
        .reduce((sum, p) => sum + (p.stock || 0), 0),
      daysToShip: null,
      orders30: 0,
      orders90: 0,
      ordersYTD: 0,
      refundRate: 0,
      refundedTotal: 0,
      grossTotal: 0,
      reserve: s.reserveBalanceCents,
      owed: s.owedToPlatformCents,
      lastActivity: null,
      alerts: [],
    });
  }

  const shipDaysBySupplier = new Map<string, number[]>();
  const orderTouchBySupplier = new Map<string, Set<string>>();
  function touch(supId: string, orderId: string, when: Date) {
    const key = `${supId}|${orderId}`;
    const seen = orderTouchBySupplier.get(supId) || new Set<string>();
    if (seen.has(orderId)) return false;
    seen.add(orderId);
    orderTouchBySupplier.set(supId, seen);
    void key;
    const m = metricsBySupplier.get(supId);
    if (!m) return false;
    if (!m.lastActivity || when > m.lastActivity) m.lastActivity = when;
    return true;
  }

  for (const it of items) {
    const supId = it.product.supplierId;
    const m = metricsBySupplier.get(supId);
    if (!m) continue;
    const o = it.order;
    const created = o.createdAt.getTime();
    const isNew = touch(supId, o.id, o.createdAt);
    if (isNew) {
      if (created >= D30) m.orders30++;
      if (created >= D90) m.orders90++;
      if (created >= YTD_START) m.ordersYTD++;
      if (created >= D90) {
        m.grossTotal += o.totalCents;
        m.refundedTotal += o.refundedCents;
      }
      // PLH-3a B1: real days-to-ship using Order.shippedAt (stamped inside
      // markOrderShipped on the actual transition). D30 window now bounds
      // the ship date, not createdAt, so the rolling 30-day metric tracks
      // recent fulfilment behaviour rather than recent order placement.
      if (
        o.paidAt &&
        o.shippedAt &&
        (o.shipmentStage === "Shipped" || o.shipmentStage === "Delivered") &&
        o.shippedAt.getTime() >= D30
      ) {
        const days = Math.max(
          0,
          Math.round((o.shippedAt.getTime() - o.paidAt.getTime()) / 86400_000)
        );
        const arr = shipDaysBySupplier.get(supId) || [];
        arr.push(days);
        shipDaysBySupplier.set(supId, arr);
      }
    }
  }

  for (const m of metricsBySupplier.values()) {
    const days = shipDaysBySupplier.get(m.id) || [];
    if (days.length > 0) {
      m.daysToShip = days.reduce((a, b) => a + b, 0) / days.length;
    }
    if (m.grossTotal > 0) {
      m.refundRate = m.refundedTotal / m.grossTotal;
    }
    if (m.refundRate > 0.05) m.alerts.push("Refund rate > 5%");
    if (m.daysToShip !== null && m.daysToShip > 7)
      m.alerts.push("Avg days-to-ship > 7");
    if (m.owed > 0) m.alerts.push("Owed to platform");
    if (m.lastActivity && now - m.lastActivity.getTime() > 30 * 86400_000) {
      m.alerts.push("Inactive > 30 days");
    }
    if (!m.lastActivity) m.alerts.push("No orders yet");
  }

  const sorted = Array.from(metricsBySupplier.values()).sort((a, b) => {
    // Suppliers with alerts float to the top.
    if (a.alerts.length !== b.alerts.length) {
      return b.alerts.length - a.alerts.length;
    }
    return a.name.localeCompare(b.name);
  });

  return (
    <main id="main" className="app-page">
      <div className="page-pad">
        <h1 className="page-title">Supplier health</h1>
        <p className="page-sub">
          Per-supplier metrics + alerts. Triage rows with badges first.
        </p>

        <div className="card" style={{ marginTop: 18 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="num">Stock</th>
                  <th className="num">Avg ship (30d)</th>
                  <th className="num">Orders 30/90/YTD</th>
                  <th className="num">Refund rate</th>
                  <th className="num">Reserve</th>
                  <th className="num">Owed</th>
                  <th>Last activity</th>
                  <th>Alerts</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link href={`/suppliers`} style={{ fontWeight: 600 }}>
                        {m.name}
                      </Link>
                    </td>
                    <td className="num">{m.stock}</td>
                    <td className="num">
                      {m.daysToShip === null
                        ? "n/a"
                        : `${m.daysToShip.toFixed(1)}d`}
                    </td>
                    <td className="num">
                      {m.orders30} / {m.orders90} / {m.ordersYTD}
                    </td>
                    <td className="num">
                      {(m.refundRate * 100).toFixed(1)}%
                    </td>
                    <td className="num">{formatCents(m.reserve)}</td>
                    <td
                      className="num"
                      style={{
                        color: m.owed > 0 ? "var(--amber-deep)" : undefined,
                        fontWeight: m.owed > 0 ? 600 : undefined,
                      }}
                    >
                      {formatCents(m.owed)}
                    </td>
                    <td>
                      {m.lastActivity
                        ? m.lastActivity.toLocaleDateString()
                        : "Never"}
                    </td>
                    <td>
                      {m.alerts.length === 0 ? (
                        <span
                          className="muted-text"
                          style={{ fontSize: 12 }}
                        >
                          OK
                        </span>
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 4,
                          }}
                        >
                          {m.alerts.map((a) => (
                            <span
                              key={a}
                              className="badge badge-cancelled"
                              style={{ fontSize: 11 }}
                            >
                              {a}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}

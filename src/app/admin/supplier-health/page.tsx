import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import Link from "next/link";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

// PLH-3j P12: alert thresholds configurable via env vars. Defaults keep
// the previously hardcoded values (refund 5%, days-to-ship 7, owed > 0,
// inactive 30d). Set in Vercel without a code change to tune for noise.
function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
const ALERT_REFUND_RATE = envNum("SUPPLIER_HEALTH_REFUND_RATE", 0.05);
const ALERT_DAYS_TO_SHIP = envNum("SUPPLIER_HEALTH_DAYS_TO_SHIP", 7);
const ALERT_OWED_CENTS = envNum("SUPPLIER_HEALTH_OWED_CENTS", 0);
const ALERT_INACTIVE_DAYS = envNum("SUPPLIER_HEALTH_INACTIVE_DAYS", 30);


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

  // PLH-3a B2: bound the orderItems query to the YTD window.
  // PLH-3g P5: still iterate items for the per-supplier order-volume +
  // refund-rate buckets (they're product-supplier scoped), but pull
  // OrderSupplierSlot rows separately for the per-supplier days-to-ship
  // metric. Per-slot shippedAt is the accurate per-supplier ship moment.
  const items = await prisma.orderItem.findMany({
    where: { order: { createdAt: { gte: new Date(YTD_START) } } },
    include: {
      order: { select: { id: true, status: true, createdAt: true,
        refundedCents: true, totalCents: true, paidAt: true } },
      product: { select: { supplierId: true } },
    },
  });

  // PLH-3g P5: pull recent shipped slots for the days-to-ship metric.
  // Bound by the parent Order's paidAt to keep the scan small.
  const recentSlots = await prisma.orderSupplierSlot.findMany({
    where: {
      shippedAt: { gte: new Date(D30) },
      shipmentStage: { in: ["Shipped", "Delivered"] },
      order: { paidAt: { not: null } },
    },
    select: {
      supplierId: true,
      shippedAt: true,
      order: { select: { paidAt: true } },
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
    }
  }

  // PLH-3g P5: per-supplier days-to-ship from OrderSupplierSlot.shippedAt
  // minus Order.paidAt. More accurate than Order.shippedAt (which is the
  // FIRST slot's ship moment, not this supplier's ship moment).
  for (const s of recentSlots) {
    if (!s.shippedAt || !s.order.paidAt) continue;
    const m = metricsBySupplier.get(s.supplierId);
    if (!m) continue;
    const days = Math.max(
      0,
      Math.round((s.shippedAt.getTime() - s.order.paidAt.getTime()) / 86400_000)
    );
    const arr = shipDaysBySupplier.get(s.supplierId) || [];
    arr.push(days);
    shipDaysBySupplier.set(s.supplierId, arr);
  }

  for (const m of metricsBySupplier.values()) {
    const days = shipDaysBySupplier.get(m.id) || [];
    if (days.length > 0) {
      m.daysToShip = days.reduce((a, b) => a + b, 0) / days.length;
    }
    if (m.grossTotal > 0) {
      m.refundRate = m.refundedTotal / m.grossTotal;
    }
    if (m.refundRate > ALERT_REFUND_RATE)
      m.alerts.push(`Refund rate > ${(ALERT_REFUND_RATE * 100).toFixed(1)}%`);
    if (m.daysToShip !== null && m.daysToShip > ALERT_DAYS_TO_SHIP)
      m.alerts.push(`Avg days-to-ship > ${ALERT_DAYS_TO_SHIP}`);
    if (m.owed > ALERT_OWED_CENTS) m.alerts.push("Owed to platform");
    if (
      m.lastActivity &&
      now - m.lastActivity.getTime() > ALERT_INACTIVE_DAYS * 86400_000
    ) {
      m.alerts.push(`Inactive > ${ALERT_INACTIVE_DAYS} days`);
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

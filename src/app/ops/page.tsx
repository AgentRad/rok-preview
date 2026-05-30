import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import OpsBoard, { type OpsOrder } from "@/components/OpsBoard";
import MarkPayoutPaid from "@/components/MarkPayoutPaid";
import AttentionFeed from "@/components/AttentionFeed";
import { getAdminAttention } from "@/lib/attention";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function OpsConsole() {
  await requireRole("ADMIN");

  const [orders, payoutsDue, attention] = await Promise.all([
    prisma.order.findMany({
      where: { status: { in: ["PAID", "FULFILLED"] } },
      include: { items: true },
      orderBy: { paidAt: "asc" },
    }),
    prisma.payout.findMany({
      where: { status: "DUE" },
      include: {
        supplier: { select: { name: true, contactEmail: true } },
        order: { select: { reference: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    getAdminAttention(),
  ]);

  const payoutsDueTotal = payoutsDue.reduce(
    (s, p) => s + p.amountCents,
    0
  );

  const board: OpsOrder[] = orders.map((o) => ({
    id: o.id,
    reference: o.reference,
    buyerName: o.buyerName,
    shipTo: o.shipTo,
    placed: o.createdAt.toLocaleDateString(),
    total: formatCents(o.totalCents),
    itemCount: o.items.reduce((n, i) => n + i.qty, 0),
    status: o.status,
    shipmentStage: o.shipmentStage,
    carrier: o.carrier,
    trackingCode: o.trackingCode,
  }));

  const open = orders.filter((o) => o.status === "PAID").length;
  const inTransit = orders.filter(
    (o) => o.status === "PAID" && o.shipmentStage === "Shipped"
  ).length;
  const delivered = orders.filter((o) => o.status === "FULFILLED").length;

  return (
    <main id="main" className="app-page">
      <div className="page-pad">
        <h1 className="page-title">Fulfillment ops</h1>
          <p className="page-sub">
            Every paid order, tracked from the warehouse to the buyer. Move an
            order along as you pick, ship, and confirm delivery.
          </p>

          <AttentionFeed
            items={attention.filter((a) =>
              ["payouts", "late-shipment", "returns"].includes(a.kind)
            )}
            emptyTitle="Nothing critical in ops right now."
            emptyBody="No overdue shipments, no payouts queued, no open returns. Use the board below to track in-flight orders."
          />

          <div className="kpi-grid">
            <div className="kpi">
              <div className="k-label">Open orders</div>
              <div className="k-value">{open}</div>
              <div className="k-foot">paid, not yet delivered</div>
            </div>
            <div className="kpi">
              <div className="k-label">In transit</div>
              <div className="k-value">{inTransit}</div>
              <div className="k-foot">shipped, awaiting delivery</div>
            </div>
            <div className="kpi">
              <div className="k-label">Delivered</div>
              <div className="k-value">{delivered}</div>
              <div className="k-foot">completed orders</div>
            </div>
            <div className="kpi">
              <div className="k-label">Admin</div>
              <div className="k-value" style={{ fontSize: 18 }}>
                <Link href="/admin" style={{ color: "var(--blue)", textDecoration: "none" }}>
                  Console
                </Link>
              </div>
              <div className="k-foot">GMV, suppliers, applications</div>
            </div>
          </div>

          {board.length === 0 ? (
            <div className="card">
              <div className="empty-block">
                <h3>No orders to fulfill yet</h3>
                <p>Paid orders appear here, ready to move through fulfillment.</p>
              </div>
            </div>
          ) : (
            <OpsBoard orders={board} />
          )}

          <div className="card">
            <div className="card-head">
              <h2>Payouts owed</h2>
              <span className="muted-text" style={{ fontSize: 13 }}>
                Outstanding to suppliers: <strong style={{ color: "var(--ink)" }}>{formatCents(payoutsDueTotal)}</strong>
              </span>
            </div>
            {payoutsDue.length === 0 ? (
              <div className="empty-block">
                <h3>No payouts due</h3>
                <p>Payouts are created when an order is marked Shipped.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Payout</th>
                      <th>Supplier</th>
                      <th>Order</th>
                      <th>Created</th>
                      <th className="num">Amount</th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutsDue.map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 700 }}>{p.reference}</td>
                        <td>
                          <div>{p.supplier.name}</div>
                          <div className="muted-text" style={{ fontSize: 12 }}>
                            {p.supplier.contactEmail}
                          </div>
                        </td>
                        <td>{p.order.reference}</td>
                        <td>{p.createdAt.toLocaleDateString()}</td>
                        <td className="num">{formatCents(p.amountCents)}</td>
                        <td className="num">
                          <MarkPayoutPaid payoutId={p.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
      </div>
    </main>
  );
}

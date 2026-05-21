import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import OpsBoard, { type OpsOrder } from "@/components/OpsBoard";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function OpsConsole() {
  await requireRole("ADMIN");

  const orders = await prisma.order.findMany({
    where: { status: { in: ["PAID", "FULFILLED"] } },
    include: { items: true },
    orderBy: { paidAt: "asc" },
  });

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
    <>
      <SiteHeader />
      <main id="main">
        <div className="page-pad">
          <h1 className="page-title">Fulfillment ops</h1>
          <p className="page-sub">
            Every paid order, tracked from the warehouse to the buyer. Move an
            order along as you pick, ship, and confirm delivery.
          </p>

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
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

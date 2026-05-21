import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ApplicationReview from "@/components/ApplicationReview";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  PENDING: "badge-pending",
  PAID: "badge-paid",
  FULFILLED: "badge-fulfilled",
  CANCELLED: "badge-cancelled",
};

export default async function AdminConsole() {
  await requireRole("ADMIN");

  const [orders, paidAgg, applications, suppliers, productCount] =
    await Promise.all([
      prisma.order.findMany({
        include: { items: true },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
      prisma.order.aggregate({
        where: { status: { in: ["PAID", "FULFILLED"] } },
        _sum: { totalCents: true, feeCents: true },
        _count: true,
      }),
      prisma.supplierApplication.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.supplier.findMany({
        include: { _count: { select: { products: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.product.count(),
    ]);

  const gmv = paidAgg._sum.totalCents || 0;
  const revenue = paidAgg._sum.feeCents || 0;

  return (
    <>
      <SiteHeader />
      <main id="main">
        <div className="page-pad">
          <h1 className="page-title">Admin console</h1>
          <p className="page-sub">
            Marketplace operations — suppliers, applications, and orders.
          </p>

          <div className="kpi-grid">
            <div className="kpi">
              <div className="k-label">GMV (paid)</div>
              <div className="k-value">{formatCents(gmv)}</div>
              <div className="k-foot">{paidAgg._count} paid orders</div>
            </div>
            <div className="kpi">
              <div className="k-label">Marketplace revenue</div>
              <div className="k-value">{formatCents(revenue)}</div>
              <div className="k-foot">4% transaction fees</div>
            </div>
            <div className="kpi">
              <div className="k-label">Suppliers</div>
              <div className="k-value">{suppliers.length}</div>
              <div className="k-foot">{productCount} listings</div>
            </div>
            <div className="kpi">
              <div className="k-label">Pending applications</div>
              <div className="k-value">{applications.length}</div>
              <div className="k-foot">awaiting review</div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Supplier applications</h2>
            </div>
            <ApplicationReview
              applications={applications.map((a) => ({
                id: a.id,
                companyName: a.companyName,
                contactName: a.contactName,
                email: a.email,
                category: a.category,
                yearsTrading: a.yearsTrading,
                certs: a.certs,
                createdAt: a.createdAt.toISOString(),
              }))}
            />
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Recent orders</h2>
            </div>
            {orders.length === 0 ? (
              <div className="empty-block">
                <h3>No orders yet</h3>
                <p>Orders placed across the marketplace appear here.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Buyer</th>
                      <th>Date</th>
                      <th>Items</th>
                      <th>Status</th>
                      <th className="num">Total</th>
                      <th className="num">Fee</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td style={{ fontWeight: 700 }}>{o.reference}</td>
                        <td>
                          <div style={{ fontSize: 13 }}>{o.buyerName}</div>
                          <div className="muted-text" style={{ fontSize: 11.5 }}>
                            {o.buyerEmail}
                          </div>
                        </td>
                        <td>{o.createdAt.toLocaleDateString()}</td>
                        <td>{o.items.reduce((n, i) => n + i.qty, 0)}</td>
                        <td>
                          <span className={"badge " + (STATUS_CLASS[o.status] || "")}>
                            {o.status}
                          </span>
                        </td>
                        <td className="num">{formatCents(o.totalCents)}</td>
                        <td className="num">{formatCents(o.feeCents)}</td>
                        <td className="num">
                          <Link
                            href={`/orders/${o.id}`}
                            style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Suppliers</h2>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th className="num">Rating</th>
                    <th className="num">On-time</th>
                    <th className="num">Listings</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.name}</td>
                      <td className="muted-text" style={{ fontSize: 12.5 }}>
                        {s.contactEmail}
                      </td>
                      <td>
                        <span className="badge badge-approved">{s.status}</span>
                      </td>
                      <td className="num">★ {s.rating.toFixed(1)}</td>
                      <td className="num">{s.onTimeRate.toFixed(1)}%</td>
                      <td className="num">{s._count.products}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

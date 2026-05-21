import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SupplierProductManager from "@/components/SupplierProductManager";
import FulfillButton from "@/components/FulfillButton";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  PAID: "badge-paid",
  FULFILLED: "badge-fulfilled",
};

export default async function SupplierDashboard() {
  const user = await requireRole("SUPPLIER");
  const supplier = await prisma.supplier.findUnique({
    where: { userId: user.id },
    include: { products: { orderBy: { createdAt: "asc" } } },
  });

  if (!supplier) {
    return (
      <>
        <SiteHeader />
        <main id="main">
          <div className="page-pad narrow">
            <h1 className="page-title">Supplier dashboard</h1>
            <div className="alert alert-info" style={{ marginTop: 16 }}>
              No supplier profile is linked to this account yet. Once an admin
              approves your supplier application, your dashboard appears here.
            </div>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const orders = await prisma.order.findMany({
    where: {
      items: { some: { product: { supplierId: supplier.id } } },
      status: { in: ["PAID", "FULFILLED"] },
    },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
  });

  let revenue = 0;
  for (const o of orders) {
    for (const it of o.items) {
      if (it.product.supplierId === supplier.id)
        revenue += it.unitPriceCents * it.qty;
    }
  }
  const unitsInStock = supplier.products.reduce((s, p) => s + p.stock, 0);

  return (
    <>
      <SiteHeader />
      <main id="main">
        <div className="page-pad">
          <h1 className="page-title">{supplier.name}</h1>
          <p className="page-sub">
            Supplier dashboard · ★ {supplier.rating.toFixed(1)} ·{" "}
            {supplier.onTimeRate.toFixed(1)}% on-time
          </p>

          <div className="kpi-grid">
            <div className="kpi">
              <div className="k-label">Active listings</div>
              <div className="k-value">
                {supplier.products.filter((p) => p.active).length}
              </div>
              <div className="k-foot">{supplier.products.length} total</div>
            </div>
            <div className="kpi">
              <div className="k-label">Units in stock</div>
              <div className="k-value">{unitsInStock.toLocaleString()}</div>
              <div className="k-foot">across all listings</div>
            </div>
            <div className="kpi">
              <div className="k-label">Orders</div>
              <div className="k-value">{orders.length}</div>
              <div className="k-foot">paid &amp; fulfilled</div>
            </div>
            <div className="kpi">
              <div className="k-label">Revenue</div>
              <div className="k-value">{formatCents(revenue)}</div>
              <div className="k-foot">your share, fees excluded</div>
            </div>
          </div>

          <SupplierProductManager
            products={supplier.products.map((p) => ({
              id: p.id,
              sku: p.sku,
              name: p.name,
              category: p.category,
              manufacturer: p.manufacturer,
              priceCents: p.priceCents,
              unit: p.unit,
              etaDays: p.etaDays,
              stock: p.stock,
              active: p.active,
            }))}
          />

          <div className="card">
            <div className="card-head">
              <h2>Incoming orders</h2>
            </div>
            {orders.length === 0 ? (
              <div className="empty-block">
                <h3>No orders yet</h3>
                <p>Paid orders containing your parts will appear here.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Date</th>
                      <th>Your items</th>
                      <th>Status</th>
                      <th className="num">Your total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      const mine = o.items.filter(
                        (i) => i.product.supplierId === supplier.id
                      );
                      const mineTotal = mine.reduce(
                        (s, i) => s + i.unitPriceCents * i.qty,
                        0
                      );
                      return (
                        <tr key={o.id}>
                          <td style={{ fontWeight: 700 }}>{o.reference}</td>
                          <td>{o.createdAt.toLocaleDateString()}</td>
                          <td>
                            {mine.map((i) => (
                              <div key={i.id} style={{ fontSize: 12.5 }}>
                                {i.qty} × {i.nameSnapshot}
                              </div>
                            ))}
                          </td>
                          <td>
                            <span className={"badge " + (STATUS_CLASS[o.status] || "")}>
                              {o.status}
                            </span>
                          </td>
                          <td className="num">{formatCents(mineTotal)}</td>
                          <td className="num">
                            {o.status === "PAID" && (
                              <FulfillButton orderId={o.id} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

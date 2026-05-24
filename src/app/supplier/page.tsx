import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  ROLE_LABEL,
  canEditCatalog,
  canFulfillOrders,
  canRespondToQuotes,
  canRunExports,
  canViewOrders,
  canViewPayouts,
  canViewQuotes,
  getActiveSupplierContext,
} from "@/lib/supplier-access";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import Link from "next/link";
import SupplierProductManager from "@/components/SupplierProductManager";
import CatalogCsvImport from "@/components/CatalogCsvImport";
import SupplierTeam from "@/components/SupplierTeam";
import FulfillButton from "@/components/FulfillButton";
import QuoteResponder from "@/components/QuoteResponder";
import ActingAsBanner from "@/components/ActingAsBanner";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  PAID: "badge-paid",
  FULFILLED: "badge-fulfilled",
  OPEN: "badge-pending",
  QUOTED: "badge-paid",
};

export default async function SupplierDashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPPLIER" && user.role !== "ADMIN") redirect("/");

  const ctx = await getActiveSupplierContext(user);
  const role = ctx?.role ?? null;
  const supplier = ctx
    ? await prisma.supplier.findUnique({
        where: { id: ctx.supplier.id },
        include: { products: { orderBy: { createdAt: "asc" } } },
      })
    : null;

  const showCatalog = canEditCatalog(role);
  const showQuotes = canViewQuotes(role);
  const canRespond = canRespondToQuotes(role);
  const showOrders = canViewOrders(role);
  const canFulfill = canFulfillOrders(role);
  const showPayouts = canViewPayouts(role);
  const showExports = canRunExports(role);

  if (!supplier) {
    return (
      <>
        <SiteHeader />
        <main id="main">
          <div className="page-pad narrow">
            <h1 className="page-title">Supplier dashboard</h1>
            <div className="alert alert-info" style={{ marginTop: 16 }}>
              {user.role === "ADMIN"
                ? "No supplier selected. Go to /admin and click 'Manage as' next to a supplier to operate their dashboard."
                : "No supplier profile is linked to this account yet. Once an admin approves your supplier application, your dashboard appears here."}
            </div>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const [orders, quotes, payouts] = await Promise.all([
    prisma.order.findMany({
      where: {
        items: { some: { product: { supplierId: supplier.id } } },
        status: { in: ["PAID", "FULFILLED"] },
      },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.quoteRequest.findMany({
      where: {
        product: { supplierId: supplier.id },
        status: { in: ["OPEN", "QUOTED"] },
      },
      include: { product: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.payout.findMany({
      where: { supplierId: supplier.id },
      include: { order: { select: { reference: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  const payoutsDue = payouts
    .filter((p) => p.status === "DUE")
    .reduce((s, p) => s + p.amountCents, 0);
  const payoutsPaid = payouts
    .filter((p) => p.status === "PAID")
    .reduce((s, p) => s + p.amountCents, 0);

  let revenue = 0;
  for (const o of orders) {
    for (const it of o.items) {
      if (it.product.supplierId === supplier.id)
        revenue += it.unitPriceCents * it.qty;
    }
  }
  const unitsInStock = supplier.products.reduce((s, p) => s + p.stock, 0);
  const openQuotes = quotes.filter((q) => q.status === "OPEN").length;

  return (
    <>
      <SiteHeader />
      <main id="main">
        <div className="page-pad">
          {ctx?.actingAsAdmin && (
            <ActingAsBanner supplierName={supplier.name} />
          )}
          <h1 className="page-title">{supplier.name}</h1>
          <p className="page-sub">
            Supplier dashboard · ★ {supplier.rating.toFixed(1)} ·{" "}
            {supplier.onTimeRate.toFixed(1)}% on-time
            {role ? ` · ${ctx?.actingAsAdmin ? "Admin override" : "Signed in as " + ROLE_LABEL[role]}` : ""}
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

          {showCatalog && (
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
                imageUrl: p.imageUrl,
              }))}
            />
          )}

          <div className="card">
            <div className="card-head">
              <h2>Team</h2>
            </div>
            <div className="card-body">
              <SupplierTeam />
            </div>
          </div>

          {showCatalog && (
            <div className="card">
              <div className="card-head">
                <h2>Bulk catalog import (CSV)</h2>
                {showExports && (
                  <a
                    href="/api/supplier/orders.csv"
                    className="btn btn-ghost btn-sm"
                    download
                  >
                    Export your orders (CSV)
                  </a>
                )}
              </div>
              <div className="card-body">
                <CatalogCsvImport />
              </div>
            </div>
          )}

          {showPayouts && (
            <div className="card">
              <div className="card-head">
                <h2>Payouts</h2>
              <div style={{ display: "flex", gap: 18, fontSize: 13 }}>
                <span className="muted-text">
                  Due <strong style={{ color: "var(--ink)" }}>{formatCents(payoutsDue)}</strong>
                </span>
                <span className="muted-text">
                  Paid <strong style={{ color: "var(--ink)" }}>{formatCents(payoutsPaid)}</strong>
                </span>
              </div>
            </div>
            {payouts.length === 0 ? (
              <div className="empty-block">
                <h3>No payouts yet</h3>
                <p>Payouts are created when an order is dispatched.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Order</th>
                      <th>Created</th>
                      <th>Status</th>
                      <th className="num">Amount</th>
                      <th>Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 700 }}>{p.reference}</td>
                        <td>{p.order.reference}</td>
                        <td>{p.createdAt.toLocaleDateString()}</td>
                        <td>
                          <span
                            className={
                              "badge " +
                              (p.status === "PAID" ? "badge-fulfilled" : "badge-pending")
                            }
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="num">{formatCents(p.amountCents)}</td>
                        <td>
                          {p.paidAt ? p.paidAt.toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}

          {showQuotes && (
          <div className="card">
            <div className="card-head">
              <h2>Quote requests{openQuotes > 0 ? ` · ${openQuotes} open` : ""}</h2>
            </div>
            {quotes.length === 0 ? (
              <div className="empty-block">
                <h3>No quote requests</h3>
                <p>RFQs for your quote-only listings appear here.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Product</th>
                      <th>Buyer</th>
                      <th>Qty</th>
                      <th>Status</th>
                      <th>Respond</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map((q) => (
                      <tr key={q.id}>
                        <td>
                          <Link
                            href={`/quotes/${q.id}`}
                            style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
                          >
                            {q.reference}
                          </Link>
                        </td>
                        <td style={{ fontSize: 13 }}>{q.product.name}</td>
                        <td>
                          <div style={{ fontSize: 13 }}>{q.buyerName}</div>
                          <div className="muted-text" style={{ fontSize: 11.5 }}>
                            {q.buyerEmail}
                          </div>
                        </td>
                        <td className="num">{q.qty}</td>
                        <td>
                          <span className={"badge " + (STATUS_CLASS[q.status] || "")}>
                            {q.status}
                          </span>
                        </td>
                        <td className="num">
                          {q.status === "OPEN" && canRespond ? (
                            <QuoteResponder quoteId={q.id} />
                          ) : q.quotedUnitCents != null ? (
                            `${formatCents(q.quotedUnitCents)} / unit`
                          ) : (
                            <span className="muted-text" style={{ fontSize: 12 }}>
                              {canRespond ? "Sent" : "Awaiting response"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}

          {showOrders && (
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
                            {o.status === "PAID" && canFulfill && (
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
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

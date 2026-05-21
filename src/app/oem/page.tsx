import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function OemDashboard() {
  const user = await requireRole("MANUFACTURER");
  const brand = user.manufacturerName || "";

  if (!brand) {
    return (
      <>
        <SiteHeader />
        <main id="main">
          <div className="page-pad narrow">
            <h1 className="page-title">Manufacturer dashboard</h1>
            <div className="alert alert-info" style={{ marginTop: 16 }}>
              No brand is linked to this account yet. Once an admin approves
              your manufacturer listing, your storefront and demand dashboard
              appear here.
            </div>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const [products, orderItems, quotes, searches] = await Promise.all([
    prisma.product.findMany({
      where: { manufacturer: brand },
      include: { supplier: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.orderItem.findMany({
      where: {
        product: { manufacturer: brand },
        order: { status: { in: ["PAID", "FULFILLED"] } },
      },
    }),
    prisma.quoteRequest.findMany({
      where: { product: { manufacturer: brand } },
    }),
    prisma.searchEvent.findMany({ orderBy: { createdAt: "desc" }, take: 80 }),
  ]);

  const unitsSold = orderItems.reduce((s, i) => s + i.qty, 0);
  const gmv = orderItems.reduce((s, i) => s + i.unitPriceCents * i.qty, 0);
  const openQuotes = quotes.filter(
    (q) => q.status === "OPEN" || q.status === "QUOTED"
  ).length;

  const distMap = new Map<
    string,
    { name: string; rating: number; count: number }
  >();
  for (const p of products) {
    const d = distMap.get(p.supplierId);
    if (d) d.count++;
    else
      distMap.set(p.supplierId, {
        name: p.supplier.name,
        rating: p.supplier.rating,
        count: 1,
      });
  }
  const distributors = [...distMap.values()].sort((a, b) => b.count - a.count);

  const demand = new Map<string, number>();
  for (const s of searches) {
    const k = s.query.trim().toLowerCase();
    if (k) demand.set(k, (demand.get(k) || 0) + 1);
  }
  const topSearches = [...demand.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <>
      <SiteHeader />
      <main id="main">
        <div className="page-pad">
          <h1 className="page-title">{brand}</h1>
          <p className="page-sub">
            Manufacturer dashboard: your demand, distributors, and sales on
            PartsPort. Every order routes to an authorized distributor, with
            zero channel conflict.
          </p>

          <div className="kpi-grid">
            <div className="kpi">
              <div className="k-label">Listings on PartsPort</div>
              <div className="k-value">{products.length}</div>
              <div className="k-foot">across your product lines</div>
            </div>
            <div className="kpi">
              <div className="k-label">Authorized distributors</div>
              <div className="k-value">{distributors.length}</div>
              <div className="k-foot">carrying your brand</div>
            </div>
            <div className="kpi">
              <div className="k-label">Units sold</div>
              <div className="k-value">{unitsSold}</div>
              <div className="k-foot">{formatCents(gmv)} through the platform</div>
            </div>
            <div className="kpi">
              <div className="k-label">Open quote requests</div>
              <div className="k-value">{openQuotes}</div>
              <div className="k-foot">buyers asking for your equipment</div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>What buyers are searching for</h2>
            </div>
            {topSearches.length === 0 ? (
              <div className="empty-block">
                <h3>No demand signal yet</h3>
                <p>Buyer searches across the marketplace will surface here.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Search term</th>
                      <th className="num">Times searched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSearches.map(([term, count]) => (
                      <tr key={term}>
                        <td style={{ fontWeight: 500 }}>{term}</td>
                        <td className="num">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div
              className="card-body"
              style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}
            >
              <span className="muted-text" style={{ fontSize: 12.5 }}>
                Live demand intelligence: what utilities and contractors are
                looking for, before it reaches your distributors.
              </span>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Your products on PartsPort</h2>
            </div>
            {products.length === 0 ? (
              <div className="empty-block">
                <h3>No listings yet</h3>
                <p>Your authorized distributors&rsquo; listings appear here.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Category</th>
                      <th>Listed by</th>
                      <th className="num">List price</th>
                      <th className="num">Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{p.name}</div>
                          <div className="muted-text" style={{ fontSize: 12 }}>
                            {p.sku}
                          </div>
                        </td>
                        <td style={{ fontSize: 13 }}>{p.category}</td>
                        <td style={{ fontSize: 13 }}>{p.supplier.name}</td>
                        <td className="num">{formatCents(p.priceCents)}</td>
                        <td className="num">{p.stock.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Authorized distributors</h2>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Distributor</th>
                    <th className="num">Rating</th>
                    <th className="num">Your products carried</th>
                  </tr>
                </thead>
                <tbody>
                  {distributors.map((d) => (
                    <tr key={d.name}>
                      <td style={{ fontWeight: 600 }}>{d.name}</td>
                      <td className="num">★ {d.rating.toFixed(1)}</td>
                      <td className="num">{d.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              className="card-body"
              style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}
            >
              <span className="muted-text" style={{ fontSize: 12.5 }}>
                Only verified, authorized distributors can list your brand, so
                counterfeit and gray-market listings are kept off the platform.
              </span>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

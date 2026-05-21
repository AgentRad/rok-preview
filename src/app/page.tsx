import Link from "next/link";
import { prisma } from "@/lib/db";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import PartIcon from "@/components/PartIcon";
import ProductCard from "@/components/ProductCard";

export const dynamic = "force-dynamic";

const CATEGORIES: { name: string; icon: string }[] = [
  { name: "Bearings", icon: "bearing" },
  { name: "Hydraulics", icon: "pump" },
  { name: "Pneumatics", icon: "cylinder" },
  { name: "Motors & Drives", icon: "motor" },
  { name: "Electrical", icon: "contactor" },
  { name: "Belts & Pulleys", icon: "belt" },
  { name: "Sensors", icon: "sensor" },
  { name: "Valves", icon: "valve" },
  { name: "Fasteners", icon: "bolt" },
  { name: "Power Transmission", icon: "gear" },
  { name: "Seals & Gaskets", icon: "gasket" },
  { name: "Cutting Tools", icon: "insert" },
];

export default async function HomePage() {
  const [productCount, supplierCount, featured] = await Promise.all([
    prisma.product.count({ where: { active: true } }),
    prisma.supplier.count({ where: { status: "APPROVED" } }),
    prisma.product.findMany({
      where: { active: true, stock: { gt: 0 } },
      include: { supplier: true },
      orderBy: { createdAt: "asc" },
      take: 4,
    }),
  ]);

  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="hero">
          <div className="wrap">
            <span className="hero-eyebrow">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Sourcing, simplified
            </span>
            <h1>
              Source industrial parts as easily as{" "}
              <span className="hl">online shopping.</span>
            </h1>
            <p className="lede">
              Type what you need. PartsPort shows every option from vetted
              suppliers — with photos, manufacturer, price and a real delivery
              ETA. We handle payment and delivery.
            </p>
            <form className="hero-search" action="/catalog" method="get" role="search">
              <input type="text" name="q" placeholder="What part are you looking for?" aria-label="Search for a part" />
              <button type="submit">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                Search
              </button>
            </form>
            <div className="hero-chips">
              <span>Popular:</span>
              <Link href="/catalog?q=ball+bearing">ball bearing</Link>
              <Link href="/catalog?cat=Hydraulics">hydraulic pump</Link>
              <Link href="/catalog?cat=Motors+%26+Drives">3-phase motor</Link>
              <Link href="/catalog?cat=Valves">stainless ball valve</Link>
              <Link href="/catalog?q=timing+belt">timing belt</Link>
            </div>
            <div className="hero-stats">
              <div><div className="num">{productCount}</div><div className="lbl">parts in catalog</div></div>
              <div><div className="num">{supplierCount}</div><div className="lbl">vetted suppliers</div></div>
              <div><div className="num">98.4%</div><div className="lbl">on-time delivery</div></div>
              <div><div className="num">4%</div><div className="lbl">flat marketplace fee</div></div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <div className="section-head center">
              <span className="eyebrow">Browse the catalog</span>
              <h2>Shop by category</h2>
              <p>Core categories covering MRO, automation, and power transmission.</p>
            </div>
            <div className="cat-grid">
              {CATEGORIES.map((c) => (
                <Link
                  key={c.name}
                  className="cat-card"
                  href={`/catalog?cat=${encodeURIComponent(c.name)}`}
                >
                  <PartIcon icon={c.icon} />
                  <span className="cat-name">{c.name}</span>
                </Link>
              ))}
            </div>
            <div className="center mt-32">
              <Link className="btn btn-dark" href="/catalog">Browse all parts</Link>
            </div>
          </div>
        </section>

        <section className="section alt">
          <div className="wrap">
            <div className="section-head center">
              <span className="eyebrow">In stock now</span>
              <h2>Featured parts</h2>
              <p>A sample of what buyers are ordering this week.</p>
            </div>
            <div className="product-grid">
              {featured.map((p) => (
                <ProductCard key={p.sku} product={p} />
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="how">
          <div className="wrap">
            <div className="section-head center">
              <span className="eyebrow">For buyers</span>
              <h2>Three steps from need to delivered</h2>
              <p>No phone tag, no quote chasing, no wondering if a supplier is legitimate.</p>
            </div>
            <div className="steps">
              <div className="step">
                <div className="step-num">01</div>
                <h3>Search what you need</h3>
                <p>Enter a part name, specification, or manufacturer number. PartsPort returns matching parts across every qualified supplier.</p>
              </div>
              <div className="step">
                <div className="step-num">02</div>
                <h3>Compare real options</h3>
                <p>See each option side by side — photo, manufacturer, price, supplier rating, and an honest delivery ETA.</p>
              </div>
              <div className="step">
                <div className="step-num">03</div>
                <h3>We deliver it</h3>
                <p>Pay once, through PartsPort. We coordinate the supplier, quality-check, and deliver to your dock.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="section alt">
          <div className="wrap">
            <div className="split">
              <div className="panel">
                <h3>How a transaction works</h3>
                <div className="fee-row"><span>Part price (set by supplier)</span><span>$612.00</span></div>
                <div className="fee-row"><span>PartsPort service fee (4%)</span><span className="amber">$24.48</span></div>
                <div className="fee-row total"><span>Buyer pays</span><span>$636.48</span></div>
                <p className="muted" style={{ marginTop: 14 }}>
                  PartsPort takes a small percentage of each transaction.
                  Suppliers get qualified demand and guaranteed payment; buyers
                  get one accountable partner.
                </p>
              </div>
              <div>
                <span className="eyebrow">For suppliers</span>
                <h2 className="section-head" style={{ marginBottom: 0 }}>
                  Qualified demand, without the chase.
                </h2>
                <p style={{ color: "var(--steel)", marginTop: 12 }}>
                  We only work with suppliers who meet our bar — and in return
                  you reach buyers who are ready to order, with payment and
                  logistics handled for you.
                </p>
                <ul className="feature-list">
                  <li><span className="ico">✓</span><div><strong>Reach active buyers</strong><span>Your catalog appears the moment a buyer searches for what you sell.</span></div></li>
                  <li><span className="ico">✓</span><div><strong>Guaranteed payment</strong><span>PartsPort collects from the buyer and pays you on dispatch.</span></div></li>
                  <li><span className="ico">✓</span><div><strong>No logistics overhead</strong><span>We coordinate delivery, returns, and buyer support.</span></div></li>
                </ul>
                <div className="mt-32">
                  <Link className="btn btn-primary" href="/suppliers">See qualification criteria</Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <div className="cta-band">
              <div>
                <h2>Find your part in the next minute.</h2>
                <p>Search the live catalog, or apply to sell as a vetted supplier.</p>
              </div>
              <div className="cta-actions">
                <Link className="btn btn-primary" href="/catalog">Browse catalog</Link>
                <Link className="btn btn-ghost" href="/suppliers" style={{ color: "#fff", borderColor: "#ffffff3a" }}>
                  Become a supplier
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

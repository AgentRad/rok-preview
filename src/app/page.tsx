import Link from "next/link";
import { prisma } from "@/lib/db";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import PartIcon from "@/components/PartIcon";
import ProductCard from "@/components/ProductCard";
import HeroSearch from "@/components/HeroSearch";
import { FEE_RATE_BPS, FEE_RATE_LABEL, formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

const CATEGORIES: { name: string; icon: string }[] = [
  { name: "Transformers", icon: "transformer" },
  { name: "Switchgear & Breakers", icon: "breaker" },
  { name: "Protective Relays", icon: "relay" },
  { name: "Conductors & Cable", icon: "cable" },
  { name: "Line Hardware", icon: "insulator" },
  { name: "Metering", icon: "meter" },
  { name: "Generators & ATS", icon: "generator" },
  { name: "Solar & Inverters", icon: "solar" },
  { name: "Energy Storage", icon: "battery" },
  { name: "Grounding & Surge", icon: "ground" },
  { name: "Controls & SCADA", icon: "controller" },
  { name: "Safety & Arc-Flash", icon: "shield" },
];

const COMPARE: { label: string; off: string; on: string }[] = [
  {
    label: "Find the right part",
    off: "Call 3 to 5 distributors, wait for callbacks",
    on: "Type it or describe it, see every vetted option",
  },
  {
    label: "Get a price",
    off: "Wait 1 to 3 days for quotes, chase email threads",
    on: "Price on screen for in-stock, same-day RFQ response target",
  },
  {
    label: "Compare options",
    off: "Spreadsheet, gut feel, hope the supplier is real",
    on: "Side by side: photo, brand, price, rating, ETA",
  },
  {
    label: "Place the order",
    off: "Cut a PO, fax or email, confirm by phone",
    on: "Click order. One invoice with subtotal, freight, fee, tax",
  },
  {
    label: "Pay",
    off: "Net 30 to 60, AP cycles, separate wire per supplier",
    on: "ACH or wire to PartsPort, one transaction, downloadable invoice",
  },
  {
    label: "Track the shipment",
    off: "Phone the carrier when nothing arrives",
    on: "Live timeline on the order page with carrier deep link",
  },
  {
    label: "If something goes wrong",
    off: "Three-way phone calls, paperwork, weeks",
    on: "Open a return on the order page, single accountable partner",
  },
];

export default async function HomePage() {
  const [productCount, supplierCount, featured] = await Promise.all([
    prisma.product.count({ where: { active: true } }),
    prisma.supplier.count({ where: { status: "APPROVED" } }),
    prisma.product.findMany({
      where: { active: true, stock: { gt: 0 } },
      include: { supplier: true, _count: { select: { images: true } } },
      orderBy: { createdAt: "asc" },
      take: 8,
    }),
  ]);

  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="hero">
          <div className="wrap">
            <span className="hero-eyebrow">The industrial parts marketplace</span>
            <h1>
              Every part you need,{" "}
              <span className="hl">in one search.</span>
            </h1>
            <p className="lede">
              Type it or describe it. Compare vetted suppliers, prices, and
              real delivery ETAs, then order. We handle the rest.
            </p>
            <HeroSearch />
            <div className="hero-chips">
              <span>Try:</span>
              <Link href="/catalog?q=transformer">transformer</Link>
              <Link href="/catalog?q=circuit+breaker">circuit breaker</Link>
              <Link href="/catalog?q=protective+relay">protective relay</Link>
              <Link href="/catalog?q=standby+generator">standby generator</Link>
            </div>
            <div className="hero-stats">
              <div><div className="num">{productCount}</div><div className="lbl">parts in catalog</div></div>
              <div><div className="num">{supplierCount}</div><div className="lbl">vetted suppliers</div></div>
              <div><div className="num">End to end</div><div className="lbl">freight, tax, invoicing handled</div></div>
              <div><div className="num">Same day</div><div className="lbl">RFQ response target</div></div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <div className="section-head center">
              <span className="eyebrow">Browse the catalog</span>
              <h2>Shop by category</h2>
              <p>Every category, sourced from vetted suppliers with delivery handled.</p>
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
                <p>See each option side by side: photo, manufacturer, price, supplier rating, and an honest delivery ETA.</p>
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
            <div className="section-head center">
              <span className="eyebrow">Same operations, one place</span>
              <h2>Sourcing one part, the old way and the PartsPort way</h2>
              <p>The work doesn&rsquo;t change. Where it happens does.</p>
            </div>
            <div className="compare">
              <div className="compare-head">
                <div></div>
                <div className="compare-col-off">Today, off-platform</div>
                <div className="compare-col-on">On PartsPort</div>
              </div>
              {COMPARE.map((row) => (
                <div className="compare-row" key={row.label}>
                  <div className="compare-label">{row.label}</div>
                  <div className="compare-off">{row.off}</div>
                  <div className="compare-on">
                    <span className="compare-check" aria-hidden="true">✓</span>
                    {row.on}
                  </div>
                </div>
              ))}
            </div>
            <p className="center muted-text" style={{ marginTop: 22, fontSize: 13.5 }}>
              Same supplier you would have called. Same delivery. Just orchestrated, recorded, and accountable.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <div className="section-head center">
              <span className="eyebrow">Pricing</span>
              <h2>One marketplace fee.</h2>
              <p>You see the supplier price; the fee is added on top.</p>
            </div>
            <div className="panel light" style={{ maxWidth: 560, margin: "0 auto" }}>
              <div className="fee-row">
                <span>Equipment price (set by supplier)</span>
                <span>{formatCents(845000)}</span>
              </div>
              <div className="fee-row">
                <span>Marketplace fee ({FEE_RATE_LABEL})</span>
                <span className="amber">+ {formatCents(Math.round((845000 * FEE_RATE_BPS) / 10000))}</span>
              </div>
              <div className="fee-row total">
                <span>Buyer pays</span>
                <span>{formatCents(845000 + Math.round((845000 * FEE_RATE_BPS) / 10000))}</span>
              </div>
            </div>
            <p className="center muted-text" style={{ marginTop: 18, fontSize: 13.5 }}>
              Freight and sales tax are separate line items at checkout, never absorbed into the fee.
            </p>
          </div>
        </section>

        <section className="section alt">
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

import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ManufacturerForm from "@/components/ManufacturerForm";

export const dynamic = "force-dynamic";

const VALUE = [
  {
    title: "Brand protection",
    body: "We verify that every seller is an authorized distributor of your brand — keeping counterfeit and gray-market listings off the platform.",
  },
  {
    title: "Zero channel conflict",
    body: "You never sell direct here. Every order routes to one of your authorized distributors, so the channel you built stays intact.",
  },
  {
    title: "Demand intelligence",
    body: "See what buyers search for, by region and segment — including backorder demand for long-lead items — and plan production against real signal.",
  },
  {
    title: "Reach the long tail",
    body: "Small co-ops, municipals, and contractors a field-sales team can't justify visiting — reached at near-zero channel cost.",
  },
  {
    title: "Qualified leads",
    body: "Structured RFQs and orders flow to your distributors, not a generic inbox — warm demand instead of cold outreach.",
  },
  {
    title: "A storefront you control",
    body: "Specs, datasheets, photos, and price ranges in one branded place — always current, so buyers and distributors quote the right thing.",
  },
];

export default function ManufacturersPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="page-hero">
          <div className="wrap">
            <span className="hero-eyebrow">For manufacturers</span>
            <h1>A demand channel that protects the one you already built.</h1>
            <p>
              List your brand on PartsPort for free. We send qualified demand
              to your authorized distributors, protect your name from
              counterfeits, and show you the end-demand you&rsquo;ve never had
              visibility into — with no channel conflict.
            </p>
            <div className="mt-32">
              <a className="btn btn-primary" href="#apply">List your brand</a>
              <Link
                className="btn btn-ghost"
                href="/how-it-works"
                style={{ color: "#fff", borderColor: "#ffffff3a", marginLeft: 10 }}
              >
                How it works
              </Link>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <div className="section-head center">
              <span className="eyebrow">Why list with us</span>
              <h2>Smoother, lower-risk, more efficient</h2>
              <p>What a manufacturer storefront on PartsPort does for your business.</p>
            </div>
            <div className="qual-grid">
              {VALUE.map((v, i) => (
                <div className="qual-card" key={v.title}>
                  <div className="q-ico">
                    <strong style={{ fontSize: 16 }}>{i + 1}</strong>
                  </div>
                  <div>
                    <h3>{v.title}</h3>
                    <p>{v.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section alt">
          <div className="wrap">
            <div className="split">
              <div>
                <span className="eyebrow">Onboarding</span>
                <h2 className="section-head" style={{ marginBottom: 24 }}>
                  Live in about a week — and free
                </h2>
                <ol className="timeline">
                  <li>
                    <h3>Tell us about your brand</h3>
                    <p>Your product lines and the distributors who carry them.</p>
                  </li>
                  <li>
                    <h3>We verify your distributors</h3>
                    <p>Only your authorized sellers can list your products.</p>
                  </li>
                  <li>
                    <h3>Your storefront goes live</h3>
                    <p>Specs, datasheets, photos, and price ranges — branded to you.</p>
                  </li>
                  <li>
                    <h3>You get demand signal</h3>
                    <p>Search and RFQ intelligence, with no obligation and no fee.</p>
                  </li>
                </ol>
              </div>
              <div className="panel">
                <h3>What it costs you</h3>
                <div className="fee-row"><span>Storefront &amp; product listings</span><span className="amber">Free</span></div>
                <div className="fee-row"><span>Demand intelligence</span><span className="amber">Free</span></div>
                <div className="fee-row"><span>Distributor verification</span><span className="amber">Free</span></div>
                <div className="fee-row total"><span>You pay</span><span>$0</span></div>
                <p className="muted" style={{ marginTop: 14 }}>
                  PartsPort earns its fee on the transaction, paid by the
                  distributor who fulfills the order. Manufacturers participate
                  free — the platform monetizes the sale, not your listing.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="apply">
          <div className="wrap">
            <div className="section-head center">
              <span className="eyebrow">Get started</span>
              <h2>List your brand on PartsPort</h2>
              <p>No cost, no channel conflict, no obligation.</p>
            </div>
            <ManufacturerForm />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

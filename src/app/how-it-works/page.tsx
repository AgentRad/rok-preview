import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export const dynamic = "force-dynamic";

type Role = {
  eyebrow: string;
  title: string;
  who: string;
  today: string[];
  withUs: string[];
};

const ROLES: Role[] = [
  {
    eyebrow: "For buyers",
    title: "Source equipment without the chase.",
    who: "Utilities, co-ops, municipals, contractors, and EPCs.",
    today: [
      "Sourcing one part means calling several distributors and waiting on quotes.",
      "Pricing and lead times are opaque — there's no easy way to compare.",
      "No simple way to confirm a supplier or a part is legitimate.",
      "Big-ticket equipment turns into weeks of back-and-forth.",
    ],
    withUs: [
      "Search — or describe — what you need; AI surfaces every vetted option.",
      "Compare photo, manufacturer, price, rating, and a real delivery ETA at a glance.",
      "Buy in-stock items instantly; request a quote for configured equipment.",
      "One invoice, one accountable partner, delivery handled end to end.",
    ],
  },
  {
    eyebrow: "For distributors",
    title: "Qualified demand, landing in one dashboard.",
    who: "Regional distributors and suppliers who stock and sell the brands.",
    today: [
      "Demand is feast-or-famine — you chase leads and spend on marketing.",
      "Quoting is manual, slow, and easy to lose track of.",
      "You carry the credit risk and chase receivables.",
      "Logistics and buyer support quietly eat your margin.",
    ],
    withUs: [
      "Qualified buyers find your listings the moment they search.",
      "Instant orders and structured RFQs arrive in one place.",
      "Guaranteed payment — PartsPort collects and pays you on dispatch.",
      "We coordinate delivery and buyer support; you focus on supply.",
    ],
  },
  {
    eyebrow: "For manufacturers",
    title: "A demand channel with zero channel conflict.",
    who: "OEMs — the companies that design and build the equipment.",
    today: [
      "You sell through distribution and are largely blind to end-demand.",
      "Counterfeit and gray-market listings put your brand at risk.",
      "Small co-ops and contractors aren't worth a field-sales visit.",
      "There's no low-cost channel to reach new buyers.",
    ],
    withUs: [
      "A free branded storefront — specs, datasheets, and price ranges.",
      "Every sale routes to your authorized distributors — no channel conflict.",
      "Verified-seller checks protect your brand from counterfeits.",
      "Demand intelligence: what buyers search, where, and backorder demand for long-lead items.",
    ],
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="page-hero">
          <div className="wrap">
            <span className="hero-eyebrow">How it works</span>
            <h1>One marketplace, three sides that finally fit together.</h1>
            <p>
              Manufacturers build it, distributors stock and sell it, buyers
              need it. PartsPort connects all three — and answers what each
              side has always struggled with.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <div className="flow">
              <div className="flow-node">
                <span className="flow-k">01</span>
                <strong>Manufacturers</strong>
                <span>Design &amp; build the equipment</span>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-node">
                <span className="flow-k">02</span>
                <strong>Distributors</strong>
                <span>Stock, list, and fulfill</span>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-node">
                <span className="flow-k">03</span>
                <strong>Buyers</strong>
                <span>Search, compare, and order</span>
              </div>
            </div>
            <p className="flow-caption">
              PartsPort sits in the middle — search and discovery, vetting,
              quoting, payment, and delivery run on one platform.
            </p>
          </div>
        </section>

        {ROLES.map((role, i) => (
          <section key={role.eyebrow} className={"section" + (i % 2 === 0 ? " alt" : "")}>
            <div className="wrap">
              <div className="section-head">
                <span className="eyebrow">{role.eyebrow}</span>
                <h2>{role.title}</h2>
                <p>{role.who}</p>
              </div>
              <div className="grid-2">
                <div className="card">
                  <div className="card-body">
                    <h3 className="hiw-h hiw-h-problem">The problem today</h3>
                    <ul className="hiw-list">
                      {role.today.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="card answer-card">
                  <div className="card-body">
                    <h3 className="hiw-h hiw-h-answer">With PartsPort</h3>
                    <ul className="hiw-list hiw-list-answer">
                      {role.withUs.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ))}

        <section className="section">
          <div className="wrap">
            <div className="cta-band">
              <div>
                <h2>See it from your side.</h2>
                <p>Browse the catalog, or set up as a supplier or manufacturer.</p>
              </div>
              <div className="cta-actions">
                <Link className="btn btn-primary" href="/catalog">Browse catalog</Link>
                <Link className="btn btn-ghost" href="/suppliers" style={{ color: "#fff", borderColor: "#ffffff3a" }}>
                  For distributors
                </Link>
                <Link className="btn btn-ghost" href="/manufacturers" style={{ color: "#fff", borderColor: "#ffffff3a" }}>
                  For manufacturers
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

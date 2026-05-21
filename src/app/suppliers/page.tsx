import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SupplierApplicationForm from "@/components/SupplierApplicationForm";

export const dynamic = "force-dynamic";

const CRITERIA = [
  {
    title: "Verified business",
    body: "A registered legal entity with at least two years of trading history and checkable trade references.",
  },
  {
    title: "Certified & authentic",
    body: "ISO 9001 or equivalent quality management, and only genuine OEM or authorized-distributor stock. No counterfeits.",
  },
  {
    title: "Lead-time reliability",
    body: "Documented lead times met on at least 95% of orders. ETAs are tracked against real delivery performance.",
  },
  {
    title: "Quality & returns process",
    body: "A defined inbound inspection process and a clear, fair return policy for defective or mis-shipped parts.",
  },
  {
    title: "Capacity & live inventory",
    body: "Accurate, regularly updated stock levels and the capacity to fulfill repeat and bulk orders.",
  },
  {
    title: "Insurance & compliance",
    body: "Current liability insurance and compliance with regulations covering any regulated parts you list.",
  },
];

export default function SuppliersPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="page-hero">
          <div className="wrap">
            <span className="hero-eyebrow">For suppliers</span>
            <h1>Sell to buyers who are ready to order.</h1>
            <p>
              PartsPort sends you qualified demand, collects payment, and
              handles delivery, so you can focus on supplying great parts. We
              work only with suppliers who meet the bar below.
            </p>
            <div className="mt-32">
              <a className="btn btn-primary" href="#apply">Apply to sell</a>
              <a
                className="btn btn-ghost"
                href="#criteria"
                style={{ color: "#fff", borderColor: "#ffffff3a", marginLeft: 10 }}
              >
                See criteria
              </a>
            </div>
          </div>
        </section>

        <section className="section alt" id="criteria">
          <div className="wrap">
            <div className="section-head center">
              <span className="eyebrow">The bar</span>
              <h2>Supplier qualification criteria</h2>
              <p>
                Buyers trust PartsPort because every supplier is vetted. To
                list, your company must meet all six.
              </p>
            </div>
            <div className="qual-grid">
              {CRITERIA.map((c, i) => (
                <div className="qual-card" key={c.title}>
                  <div className="q-ico">
                    <strong style={{ fontSize: 18 }}>{i + 1}</strong>
                  </div>
                  <div>
                    <h3>{c.title}</h3>
                    <p>{c.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <div className="split">
              <div>
                <span className="eyebrow">Onboarding</span>
                <h2 className="section-head" style={{ marginBottom: 24 }}>
                  From application to live in about a week
                </h2>
                <ol className="timeline">
                  <li>
                    <h3>Apply</h3>
                    <p>Submit your company profile and category mix.</p>
                  </li>
                  <li>
                    <h3>Document review</h3>
                    <p>We verify registration, certifications, and insurance.</p>
                  </li>
                  <li>
                    <h3>Catalog onboarding</h3>
                    <p>Add listings from your supplier dashboard: photos, specs, pricing, live stock.</p>
                  </li>
                  <li>
                    <h3>Go live</h3>
                    <p>Your parts appear in buyer search. You&rsquo;re paid on dispatch of every order.</p>
                  </li>
                </ol>
              </div>
              <div className="panel">
                <h3>What a transaction looks like</h3>
                <div className="fee-row"><span>Buyer orders your equipment</span><span>$8,450.00</span></div>
                <div className="fee-row"><span>PartsPort service fee (4%)</span><span className="amber">+ $338.00</span></div>
                <div className="fee-row"><span>Buyer is charged</span><span>$8,788.00</span></div>
                <div className="fee-row total"><span>You receive on dispatch</span><span>$8,450.00</span></div>
                <p className="muted" style={{ marginTop: 14 }}>
                  You set the part price and keep it in full. PartsPort&rsquo;s
                  small percentage is added on top.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section alt" id="apply">
          <div className="wrap">
            <div className="section-head center">
              <span className="eyebrow">Apply</span>
              <h2>Apply to become a supplier</h2>
              <p>
                If you meet the criteria, our supplier team will review and
                approve your account.
              </p>
            </div>
            <SupplierApplicationForm />
            <p className="center" style={{ marginTop: 18 }}>
              <Link href="/login" style={{ color: "var(--blue)", fontWeight: 600 }}>
                Already approved? Sign in to your dashboard →
              </Link>
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { siteUrl } from "@/lib/site-url";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Manufacturers",
  description:
    "Every brand on PartsPort, from Siemens and ABB to specialty manufacturers. Browse their authorized distributors and live listings.",
  alternates: { canonical: siteUrl("/manufacturers") },
  openGraph: {
    title: "Manufacturers | PartsPort",
    description:
      "Every brand on PartsPort. Browse authorized distributors and live listings.",
    type: "website",
    url: siteUrl("/manufacturers"),
    siteName: "PartsPort",
    images: [{ url: "/og-default.svg", width: 1200, height: 630, alt: "PartsPort manufacturers" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Manufacturers | PartsPort",
    description: "Every brand on PartsPort, with authorized distributors and live listings.",
    images: ["/og-default.svg"],
  },
};
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ManufacturerForm from "@/components/ManufacturerForm";
import { manufacturerSlug } from "@/lib/manufacturer-slug";
import { publicProductFilter } from "@/lib/supplier-access";

export const dynamic = "force-dynamic";

type LiveBrand = {
  name: string;
  slug: string;
  logoUrl: string | null;
  tagline: string;
  productCount: number;
  /** True when an OEM (MANUFACTURER) user has registered this brand. */
  claimed: boolean;
};

async function getLiveBrands(): Promise<LiveBrand[]> {
  // Brands are any (a) MANUFACTURER user with a name set, plus (b) any
  // manufacturer string that appears on an active Product. We dedupe by name.
  const [oems, productGroups] = await Promise.all([
    prisma.user.findMany({
      where: { role: "MANUFACTURER", manufacturerName: { not: null } },
      select: {
        manufacturerName: true,
        manufacturerTagline: true,
        manufacturerLogoUrl: true,
      },
    }),
    prisma.product.groupBy({
      by: ["manufacturer"],
      // P9.5 CRIT 7: filter through publicProductFilter so the brand
      // counts on the public /manufacturers index reflect only listings
      // from publicly visible suppliers. Pre-P9.5 this leaked counts
      // from hidden suppliers and surfaced brands whose listings come
      // entirely from invisible distributors.
      where: { active: true, ...publicProductFilter() },
      _count: { _all: true },
    }),
  ]);
  const counts = new Map<string, number>();
  for (const g of productGroups) counts.set(g.manufacturer, g._count._all);
  // Build the OEM-backed brands first (these get custom logo + tagline)
  const byName = new Map<string, LiveBrand>();
  for (const o of oems) {
    if (!o.manufacturerName) continue;
    byName.set(o.manufacturerName, {
      name: o.manufacturerName,
      slug: manufacturerSlug(o.manufacturerName),
      logoUrl: o.manufacturerLogoUrl,
      tagline: o.manufacturerTagline,
      productCount: counts.get(o.manufacturerName) ?? 0,
      claimed: true,
    });
  }
  // Add product-only brands (no OEM user yet) so the page reflects the real catalog
  for (const [name, count] of counts) {
    if (!byName.has(name)) {
      byName.set(name, {
        name,
        slug: manufacturerSlug(name),
        logoUrl: null,
        tagline: "",
        productCount: count,
        claimed: false,
      });
    }
  }
  return [...byName.values()]
    .filter((b) => b.productCount > 0)
    .sort((a, b) => b.productCount - a.productCount);
}

const VALUE = [
  {
    title: "Brand protection",
    body: "We verify that every seller is an authorized distributor of your brand, keeping counterfeit and gray-market listings off the platform.",
  },
  {
    title: "Zero channel conflict",
    body: "You never sell direct here. Every order routes to one of your authorized distributors, so the channel you built stays intact.",
  },
  {
    title: "Demand intelligence",
    body: "See what buyers search for, by region and segment, including backorder demand for long-lead items, then plan production against real signal.",
  },
  {
    title: "Reach the long tail",
    body: "Small co-ops, municipals, and contractors a field-sales team can't justify visiting, reached at near-zero channel cost.",
  },
  {
    title: "Qualified leads",
    body: "Structured RFQs and orders flow to your distributors, not a generic inbox. Warm demand instead of cold outreach.",
  },
  {
    title: "A storefront you control",
    body: "Specs, datasheets, photos, and price ranges in one branded place, always current, so buyers and distributors quote the right thing.",
  },
];

export default async function ManufacturersPage() {
  const brands = await getLiveBrands();
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
              visibility into, with no channel conflict.
            </p>
            <div className="mt-32">
              <a className="btn btn-primary" href="#apply">List your brand</a>
              <Link
                className="btn btn-ghost btn-ghost-dark"
                href="/how-it-works"
                style={{ marginLeft: 10 }}
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

        {brands.length > 0 && (
          <section className="section">
            <div className="wrap">
              <div className="section-head center">
                <span className="eyebrow">Brands</span>
                <h2>{brands.length} manufacturer{brands.length === 1 ? "" : "s"} on PartsPort</h2>
                <p>Each storefront verified, each distributor vetted, each search routed back as demand signal.</p>
              </div>
              <div className="brand-grid">
                {brands.map((b) => (
                  <Link
                    key={b.slug}
                    href={`/manufacturers/${b.slug}`}
                    className={
                      "brand-card" + (b.claimed ? " is-claimed" : "")
                    }
                  >
                    <div className="brand-card-logo">
                      {b.logoUrl ? (
                        <Image
                          src={b.logoUrl}
                          alt={`${b.name} logo`}
                          width={120}
                          height={120}
                          sizes="80px"
                          loading="lazy"
                        />
                      ) : (
                        <div className="brand-card-placeholder">
                          {b.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="brand-card-name">
                        {b.name}
                        {b.claimed && (
                          <span className="brand-claimed" title="Verified manufacturer presence">
                            ✓ Claimed
                          </span>
                        )}
                      </div>
                      {b.tagline ? (
                        <div className="brand-card-tagline">{b.tagline}</div>
                      ) : (
                        <div className="brand-card-tagline muted-text">
                          {b.productCount} listing{b.productCount === 1 ? "" : "s"}
                          {!b.claimed && " · storefront unclaimed"}
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="section alt">
          <div className="wrap">
            <div className="split">
              <div>
                <span className="eyebrow">Onboarding</span>
                <h2 className="section-head" style={{ marginBottom: 24 }}>
                  Live in about a week, and free
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
                    <p>Specs, datasheets, photos, and price ranges, branded to you.</p>
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
                  free. The platform monetizes the sale, not your listing.
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

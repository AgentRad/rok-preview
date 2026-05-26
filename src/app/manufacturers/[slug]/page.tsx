import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { siteUrl } from "@/lib/site-url";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ProductCard from "@/components/ProductCard";
import { manufacturerSlug } from "@/lib/manufacturer-slug";
import { publicProductFilter } from "@/lib/supplier-access";

export const dynamic = "force-dynamic";

type ResolvedBrand = {
  name: string;
  claimed: boolean;
  // Editable storefront fields. All empty for unclaimed brands.
  tagline: string;
  bio: string;
  logoUrl: string | null;
  website: string;
};

/**
 * Resolve a brand by its URL slug from two sources:
 *   1. An OEM (User row) whose manufacturerName slugifies to the requested slug.
 *      This is the "claimed" storefront with full editor-managed content.
 *   2. Any Product.manufacturer value whose slug matches, when no OEM exists.
 *      This is the "unclaimed" stub storefront: same catalog + distributors,
 *      but no bio / tagline / logo, and includes a Claim CTA.
 *
 * Returns null (=> 404) only when the slug matches neither source. Pre-fix,
 * 31 of 32 brands on /manufacturers were dead links because we required the
 * OEM user row to exist.
 */
async function resolveBrand(slug: string): Promise<ResolvedBrand | null> {
  // Try claimed brands first.
  const oems = await prisma.user.findMany({
    where: { role: "MANUFACTURER", manufacturerName: { not: null } },
    select: {
      manufacturerName: true,
      manufacturerTagline: true,
      manufacturerBio: true,
      manufacturerLogoUrl: true,
      manufacturerWebsite: true,
    },
  });
  const oem = oems.find(
    (u) => u.manufacturerName && manufacturerSlug(u.manufacturerName) === slug
  );
  if (oem && oem.manufacturerName) {
    return {
      name: oem.manufacturerName,
      claimed: true,
      tagline: oem.manufacturerTagline,
      bio: oem.manufacturerBio,
      logoUrl: oem.manufacturerLogoUrl,
      website: oem.manufacturerWebsite,
    };
  }
  // Fall back: any manufacturer string that appears on an active product.
  const productMfrs = await prisma.product.findMany({
    where: { active: true, ...publicProductFilter() },
    select: { manufacturer: true },
    distinct: ["manufacturer"],
  });
  const match = productMfrs.find(
    (p) => manufacturerSlug(p.manufacturer) === slug
  );
  if (match) {
    return {
      name: match.manufacturer,
      claimed: false,
      tagline: "",
      bio: "",
      logoUrl: null,
      website: "",
    };
  }
  return null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const brand = await resolveBrand(slug);
  if (!brand) return { title: "Manufacturer not found", robots: { index: false, follow: false } };
  const title = brand.name;
  const desc = (
    brand.bio ||
    brand.tagline ||
    `${brand.name} parts and equipment on PartsPort. Every listing routes to an authorized distributor at checkout.`
  ).slice(0, 200);
  const url = siteUrl(`/manufacturers/${slug}`);
  const img = brand.logoUrl || "/og-default.svg";
  return {
    title,
    description: desc,
    alternates: { canonical: url },
    openGraph: {
      title: `${title} | PartsPort`,
      description: desc,
      type: "website",
      url,
      siteName: "PartsPort",
      images: [{ url: img, width: 1200, height: 630, alt: `${brand.name} on PartsPort` }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | PartsPort`,
      description: desc,
      images: [img],
    },
  };
}

export default async function ManufacturerStorefront({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const brandData = await resolveBrand(slug);
  if (!brandData) notFound();
  const { name: brand, claimed } = brandData;
  const viewer = await getCurrentUser();
  const viewerCanBuy =
    !viewer || viewer.role === "BUYER" || viewer.role === "ADMIN";

  // Products and their distributors (same for claimed + unclaimed).
  const products = await prisma.product.findMany({
    where: { manufacturer: brand, active: true, ...publicProductFilter() },
    include: {
      supplier: true,
      _count: { select: { images: true } },
    },
    orderBy: { priceCents: "desc" },
  });

  const distMap = new Map<
    string,
    { name: string; rating: number; logoUrl: string | null; productCount: number }
  >();
  for (const p of products) {
    const existing = distMap.get(p.supplierId);
    if (existing) existing.productCount++;
    else
      distMap.set(p.supplierId, {
        name: p.supplier.name,
        rating: p.supplier.rating,
        logoUrl: p.supplier.logoUrl,
        productCount: 1,
      });
  }
  const distributors = [...distMap.values()].sort(
    (a, b) => b.productCount - a.productCount
  );

  const orgJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brand,
    url: siteUrl(`/manufacturers/${slug}`),
    ...(brandData.logoUrl ? { logo: siteUrl(brandData.logoUrl) } : {}),
    ...(brandData.website ? { sameAs: [brandData.website] } : {}),
    ...(brandData.bio ? { description: brandData.bio } : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
      <SiteHeader />
      <main id="main">
        <section className="mfr-hero">
          <div className="wrap">
            <div className="mfr-hero-grid">
              <div className="mfr-hero-mark">
                {brandData.logoUrl ? (
                  <Image
                    src={brandData.logoUrl}
                    alt={`${brand} logo`}
                    width={200}
                    height={200}
                    sizes="160px"
                    priority
                  />
                ) : (
                  <div className="mfr-hero-placeholder">
                    {brand.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div>
                <div className="hero-eyebrow">
                  {claimed
                    ? "Manufacturer storefront"
                    : "Vetted distributors on PartsPort"}
                </div>
                <h1>{brand}</h1>
                {claimed && brandData.tagline ? (
                  <p className="mfr-tagline">{brandData.tagline}</p>
                ) : !claimed ? (
                  <p className="mfr-tagline">
                    {distributors.length > 0
                      ? `Authorized ${brand} distributors sell on PartsPort. Every listing routes to a vetted distributor at checkout, so the channel stays intact.`
                      : `${brand} parts will appear here once an authorized distributor lists them.`}
                  </p>
                ) : null}
                <div className="mfr-hero-meta">
                  <span>
                    <strong>{products.length}</strong> listing
                    {products.length === 1 ? "" : "s"}
                  </span>
                  <span>·</span>
                  <span>
                    <strong>{distributors.length}</strong> authorized distributor
                    {distributors.length === 1 ? "" : "s"}
                  </span>
                  {claimed && brandData.website && (
                    <>
                      <span>·</span>
                      <a
                        href={brandData.website}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {brandData.website
                          .replace(/^https?:\/\//, "")
                          .replace(/\/$/, "")}
                      </a>
                    </>
                  )}
                </div>
                {!claimed && (
                  <div className="claim-cta">
                    <strong>Are you {brand}?</strong>
                    <span>
                      This storefront is unclaimed. Claim it to add your logo,
                      tagline, bio, and see live demand from buyers searching
                      for your parts.
                    </span>
                    <Link
                      href="/manufacturers#apply"
                      className="btn btn-primary btn-sm"
                    >
                      Claim this storefront
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {claimed && brandData.bio && (
          <section className="section alt">
            <div className="wrap mfr-bio">
              <p>{brandData.bio}</p>
            </div>
          </section>
        )}

        <section className="section">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow">Catalog</span>
              <h2>{brand} parts on PartsPort</h2>
              <p>
                Every listing routes to an authorized distributor at checkout,
                so {brand}&rsquo;s channel stays intact.
              </p>
            </div>
            {products.length === 0 ? (
              <div className="empty-state">
                <h3>No listings yet</h3>
                <p>
                  Authorized distributors haven&rsquo;t added {brand} parts to
                  PartsPort.{" "}
                  <Link href="/suppliers">Apply as a distributor</Link>.
                </p>
              </div>
            ) : (
              <div className="product-grid">
                {products.map((p) => (
                  <ProductCard
                    key={p.sku}
                    viewerCanBuy={viewerCanBuy}
                    product={{
                      sku: p.sku,
                      name: p.name,
                      category: p.category,
                      manufacturer: p.manufacturer,
                      icon: p.icon,
                      imageUrl: p.imageUrl,
                      priceCents: p.priceCents,
                      unit: p.unit,
                      etaDays: p.etaDays,
                      stock: p.stock,
                      quoteOnly: p.quoteOnly,
                      _count: { images: p._count.images },
                      supplierId: p.supplierId,
                      supplier: {
                        name: p.supplier.name,
                        rating: p.supplier.rating,
                        logoUrl: p.supplier.logoUrl,
                      },
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {distributors.length > 0 && (
          <section className="section alt">
            <div className="wrap">
              <div className="section-head">
                <span className="eyebrow">Distribution</span>
                <h2>Authorized distributors</h2>
                <p>
                  Counterfeit and gray-market listings are kept off PartsPort.
                  Only these distributors are approved to sell {brand}.
                </p>
              </div>
              <div className="mfr-dist-grid">
                {distributors.map((d) => (
                  <div className="mfr-dist-card" key={d.name}>
                    <div className="mfr-dist-logo">
                      {d.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={d.logoUrl} alt={`${d.name} logo`} />
                      ) : (
                        <div className="mfr-dist-placeholder">
                          {d.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{d.name}</div>
                      <div className="muted-text" style={{ fontSize: 12.5 }}>
                        ★ {d.rating.toFixed(1)} · {d.productCount} {brand}{" "}
                        listing{d.productCount === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {!claimed && (
          <section className="section">
            <div className="wrap">
              <div className="claim-callout">
                <h3>This is {brand}&rsquo;s storefront. They haven&rsquo;t claimed it yet.</h3>
                <p>
                  Buyers find it through search, the brand index, and product
                  detail pages. When {brand} claims it, the page becomes
                  fully editable: logo, tagline, bio, website, and live
                  demand-signal data from buyer searches.
                </p>
                <Link
                  href="/manufacturers#apply"
                  className="btn btn-primary"
                >
                  Claim {brand} on PartsPort
                </Link>
              </div>
            </div>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

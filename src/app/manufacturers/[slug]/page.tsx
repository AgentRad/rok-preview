import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ProductCard from "@/components/ProductCard";
import { manufacturerSlug } from "@/lib/manufacturer-slug";

export const dynamic = "force-dynamic";

export default async function ManufacturerStorefront({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Find the manufacturer User row whose slug-of-manufacturerName matches.
  // We pull all MANUFACTURER users (low cardinality) and match in-memory
  // since Prisma can't compute slugs server-side. Once we cross ~100 OEMs
  // we'll store a real slug column.
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
  if (!oem || !oem.manufacturerName) notFound();
  const brand = oem.manufacturerName;

  // Products and their distributors.
  const products = await prisma.product.findMany({
    where: { manufacturer: brand, active: true },
    include: {
      supplier: true,
      _count: { select: { images: true } },
    },
    orderBy: { priceCents: "desc" },
  });

  const distMap = new Map<string, { name: string; rating: number; logoUrl: string | null; productCount: number }>();
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

  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="mfr-hero">
          <div className="wrap">
            <div className="mfr-hero-grid">
              <div className="mfr-hero-mark">
                {oem.manufacturerLogoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={oem.manufacturerLogoUrl} alt={`${brand} logo`} />
                ) : (
                  <div className="mfr-hero-placeholder">
                    {brand.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div>
                <div className="hero-eyebrow">Manufacturer storefront</div>
                <h1>{brand}</h1>
                {oem.manufacturerTagline && (
                  <p className="mfr-tagline">{oem.manufacturerTagline}</p>
                )}
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
                  {oem.manufacturerWebsite && (
                    <>
                      <span>·</span>
                      <a
                        href={oem.manufacturerWebsite}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {oem.manufacturerWebsite.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      </a>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {oem.manufacturerBio && (
          <section className="section alt">
            <div className="wrap mfr-bio">
              <p>{oem.manufacturerBio}</p>
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
                  PartsPort. <Link href="/suppliers">Apply as a distributor</Link>.
                </p>
              </div>
            ) : (
              <div className="product-grid">
                {products.map((p) => (
                  <ProductCard
                    key={p.sku}
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
                        ★ {d.rating.toFixed(1)} · {d.productCount} {brand} listing
                        {d.productCount === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

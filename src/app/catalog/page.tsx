import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ProductCard from "@/components/ProductCard";
import CatalogSort from "@/components/CatalogSort";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; cat?: string; sort?: string; instock?: string };

const ORDER: Record<string, Prisma.ProductOrderByWithRelationInput> = {
  "price-asc": { priceCents: "asc" },
  "price-desc": { priceCents: "desc" },
  eta: { etaDays: "asc" },
  rating: { supplier: { rating: "desc" } },
  featured: { createdAt: "asc" },
};

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = (sp.q || "").trim();
  const cat = sp.cat || "";
  const sort = sp.sort || "featured";
  const inStock = sp.instock === "1";

  const where: Prisma.ProductWhereInput = { active: true };
  if (cat) where.category = cat;
  if (inStock) where.stock = { gt: 0 };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { manufacturer: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }

  const [products, grouped] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { supplier: true },
      orderBy: ORDER[sort] || ORDER.featured,
    }),
    prisma.product.groupBy({
      by: ["category"],
      where: { active: true },
      _count: true,
      orderBy: { category: "asc" },
    }),
  ]);

  function hrefWith(patch: Partial<SearchParams>) {
    const next = new URLSearchParams();
    const merged: SearchParams = { q, cat, sort, instock: inStock ? "1" : "", ...patch };
    if (merged.q) next.set("q", merged.q);
    if (merged.cat) next.set("cat", merged.cat);
    if (merged.sort && merged.sort !== "featured") next.set("sort", merged.sort);
    if (merged.instock === "1") next.set("instock", "1");
    const s = next.toString();
    return s ? `/catalog?${s}` : "/catalog";
  }

  return (
    <>
      <SiteHeader />
      <main id="main">
        <div className="catalog-head">
          <div className="wrap">
            <div className="breadcrumb">
              <Link href="/">Home</Link> › Catalog
              {cat ? ` › ${cat}` : ""}
            </div>
            <h1>{cat || "Industrial parts catalog"}</h1>
            <p>
              Compare options from vetted suppliers — photo, manufacturer,
              price, rating, and delivery ETA.
            </p>
          </div>
        </div>

        <div className="catalog-layout">
          <aside className="filters" aria-label="Filters">
            <div className="filter-group">
              <h3>Category</h3>
              <Link
                href={hrefWith({ cat: "" })}
                className="filter-opt"
                style={{ fontWeight: cat ? 400 : 700, textDecoration: "none", color: "inherit" }}
              >
                All categories
                <span className="count">
                  {grouped.reduce((n, g) => n + g._count, 0)}
                </span>
              </Link>
              {grouped.map((g) => (
                <Link
                  key={g.category}
                  href={hrefWith({ cat: g.category })}
                  className="filter-opt"
                  style={{
                    fontWeight: cat === g.category ? 700 : 400,
                    textDecoration: "none",
                    color: cat === g.category ? "var(--amber-dark)" : "inherit",
                  }}
                >
                  {g.category}
                  <span className="count">{g._count}</span>
                </Link>
              ))}
            </div>
            <div className="filter-group">
              <h3>Availability</h3>
              <Link
                href={hrefWith({ instock: inStock ? "" : "1" })}
                className="filter-opt"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <input type="checkbox" readOnly checked={inStock} />
                In stock now
              </Link>
            </div>
            {(q || cat || inStock) && (
              <Link href="/catalog" className="filter-clear" style={{ display: "inline-block" }}>
                Clear all filters
              </Link>
            )}
          </aside>

          <div>
            <div className="results-bar">
              <span className="results-count">
                <strong>{products.length}</strong> part
                {products.length === 1 ? "" : "s"}
                {q ? ` for “${q}”` : ""}
              </span>
              <CatalogSort value={sort} />
            </div>

            {products.length === 0 ? (
              <div className="empty-block">
                <h3>No parts match your search</h3>
                <p>
                  Try a different term or clear filters. Need something not
                  listed? <Link href="/suppliers">We source it.</Link>
                </p>
              </div>
            ) : (
              <div className="product-grid">
                {products.map((p) => (
                  <ProductCard key={p.sku} product={p} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

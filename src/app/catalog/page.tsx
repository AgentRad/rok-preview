import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runSearch, type SearchProduct } from "@/lib/search";
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

function sortInMemory(list: SearchProduct[], sort: string): SearchProduct[] {
  const l = [...list];
  switch (sort) {
    case "price-asc": l.sort((a, b) => a.priceCents - b.priceCents); break;
    case "price-desc": l.sort((a, b) => b.priceCents - a.priceCents); break;
    case "eta": l.sort((a, b) => a.etaDays - b.etaDays); break;
    case "rating": l.sort((a, b) => b.supplier.rating - a.supplier.rating); break;
    default: break; // 'featured' keeps relevance order
  }
  return l;
}

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

  const grouped = await prisma.product.groupBy({
    by: ["category"],
    where: { active: true },
    _count: true,
    orderBy: { category: "asc" },
  });

  let products: SearchProduct[];
  let interpretation = "";
  let aiSearch = false;

  if (q) {
    const result = await runSearch(q);
    interpretation = result.interpretation;
    aiSearch = result.ai;
    products = result.products.filter((p) => {
      if (cat && p.category !== cat) return false;
      if (inStock && p.stock <= 0) return false;
      return true;
    });
    products = sortInMemory(products, sort);
  } else {
    const where: Prisma.ProductWhereInput = { active: true };
    if (cat) where.category = cat;
    if (inStock) where.stock = { gt: 0 };
    products = await prisma.product.findMany({
      where,
      include: { supplier: true },
      orderBy: ORDER[sort] || ORDER.featured,
    });
  }

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
            <h1>{cat || "Parts catalog"}</h1>
            <p>
              Compare parts from vetted suppliers — photo, manufacturer,
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
                    color: cat === g.category ? "var(--amber-deep)" : "inherit",
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
            {q && (
              <div className="ai-banner">
                <span className="ai-spark" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5 9.8 12.2 3.5 10l6.3-1.7z" />
                  </svg>
                </span>
                <div>
                  <div className="ai-banner-label">
                    {aiSearch ? "AI search" : "Search"} ·{" "}
                    <span className="ai-query">&ldquo;{q}&rdquo;</span>
                  </div>
                  <div className="ai-banner-text">
                    {interpretation}
                    {aiSearch ? "" : ""}
                  </div>
                </div>
              </div>
            )}

            <div className="results-bar">
              <span className="results-count">
                <strong>{products.length}</strong> part
                {products.length === 1 ? "" : "s"}
              </span>
              <CatalogSort value={sort} />
            </div>

            {products.length === 0 ? (
              <div className="empty-block">
                <h3>No parts match your search</h3>
                <p>
                  Try describing the part differently, or{" "}
                  <Link href="/suppliers">request a part we don&rsquo;t list</Link>.
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

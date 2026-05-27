import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { siteUrl } from "@/lib/site-url";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Catalog",
  description:
    "Browse the PartsPort catalog: transformers, switchgear, relays, conductors, metering, generators, solar, storage, grounding, and SCADA, listed by vetted distributors with live pricing and delivery ETAs.",
  alternates: { canonical: siteUrl("/catalog") },
  openGraph: {
    title: "Catalog | PartsPort",
    description:
      "Search vetted distributors for industrial parts. Live pricing, real delivery ETAs, one-click ordering.",
    type: "website",
    url: siteUrl("/catalog"),
    siteName: "PartsPort",
    images: [{ url: "/og-default.svg", width: 1200, height: 630, alt: "PartsPort catalog" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Catalog | PartsPort",
    description: "Search vetted distributors for industrial parts.",
    images: ["/og-default.svg"],
  },
};
import { headers } from "next/headers";
import { runSearch, type SearchProduct } from "@/lib/search";
import { rateLimit } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ProductCard from "@/components/ProductCard";
import CatalogSort from "@/components/CatalogSort";
import MobileFilterToggle from "@/components/MobileFilterToggle";
import { publicProductFilter } from "@/lib/supplier-access";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  cat?: string;
  mfr?: string;
  sort?: string;
  instock?: string;
  page?: string;
};

const PAGE_SIZE = 24;

// Featured uses an array sort: shoppable (instant-checkout) items first,
// then quote-only items below. First-time buyers click a tile expecting to
// shop; landing them on "Request a quote" tiles felt like a dead end. Newer
// listings break ties within each group.
const ORDER: Record<
  string,
  Prisma.ProductOrderByWithRelationInput | Prisma.ProductOrderByWithRelationInput[]
> = {
  "price-asc": { priceCents: "asc" },
  "price-desc": { priceCents: "desc" },
  eta: { etaDays: "asc" },
  rating: { supplier: { rating: "desc" } },
  featured: [{ quoteOnly: "asc" }, { createdAt: "asc" }],
};

/** Compact page list: 1, 2, …, current-1, current, current+1, …, last */
function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}

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
  const mfr = sp.mfr || "";
  const sort = sp.sort || "featured";
  // Buyer-eligible viewers see the QuickAdd CTA on product cards. OEMs
  // and suppliers don't (matches the gated buy flow on the detail page).
  const viewer = await getCurrentUser();
  const viewerCanBuy =
    !viewer || viewer.role === "BUYER" || viewer.role === "ADMIN";
  const inStock = sp.instock === "1";
  const requestedPage = Math.max(1, parseInt(sp.page || "1", 10) || 1);

  const publicFilter = publicProductFilter();
  const [grouped, manufacturers] = await Promise.all([
    prisma.product.groupBy({
      by: ["category"],
      where: { active: true, ...publicFilter },
      _count: true,
      orderBy: { category: "asc" },
    }),
    prisma.product.groupBy({
      by: ["manufacturer"],
      where: {
        active: true,
        ...publicFilter,
        ...(cat ? { category: cat } : {}),
      },
      _count: true,
      orderBy: { manufacturer: "asc" },
    }),
  ]);

  let allProducts: SearchProduct[];
  let totalCount: number;
  let interpretation = "";
  let aiSearch = false;

  if (q) {
    // PLH-2 Phase 4b (B1): cap query length and rate-limit the AI path per
    // client IP. Above the cap we fall back to the heuristic-only ranker so
    // the page still renders. Anonymous traffic to `/catalog?q=...` used to
    // trigger an Anthropic Opus call per request with no auth gate.
    const cappedQ = q.length > 200 ? q.slice(0, 200) : q;
    const h = await headers();
    const xff = h.get("x-forwarded-for") || "";
    const ip = xff.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
    const aiLimit = await rateLimit("ai-search", ip);
    const result = await runSearch(cappedQ, { skipAi: !aiLimit.allowed });
    interpretation = result.interpretation;
    aiSearch = result.ai;
    allProducts = result.products.filter((p) => {
      if (cat && p.category !== cat) return false;
      if (mfr && p.manufacturer !== mfr) return false;
      if (inStock && p.stock <= 0) return false;
      return true;
    });
    allProducts = sortInMemory(allProducts, sort);
    totalCount = allProducts.length;
  } else {
    const where: Prisma.ProductWhereInput = { active: true, ...publicFilter };
    if (cat) where.category = cat;
    if (mfr) where.manufacturer = mfr;
    if (inStock) where.stock = { gt: 0 };
    const [list, count] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { supplier: true, _count: { select: { images: true } } },
        orderBy: ORDER[sort] || ORDER.featured,
      }),
      prisma.product.count({ where }),
    ]);
    allProducts = list;
    totalCount = count;
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const products = allProducts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function hrefWith(patch: Partial<SearchParams>) {
    const next = new URLSearchParams();
    const merged: SearchParams = {
      q,
      cat,
      mfr,
      sort,
      instock: inStock ? "1" : "",
      page: String(page),
      ...patch,
    };
    if (merged.q) next.set("q", merged.q);
    if (merged.cat) next.set("cat", merged.cat);
    if (merged.mfr) next.set("mfr", merged.mfr);
    if (merged.sort && merged.sort !== "featured") next.set("sort", merged.sort);
    if (merged.instock === "1") next.set("instock", "1");
    if (merged.page && merged.page !== "1") next.set("page", merged.page);
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
              Compare parts from vetted suppliers: photo, manufacturer,
              price, rating, and delivery ETA.
            </p>
          </div>
        </div>

        <div className="catalog-layout">
          <MobileFilterToggle targetId="catalog-filters" />
          <aside id="catalog-filters" className="filters" aria-label="Filters">
            <div className="filter-group">
              <h2>Category</h2>
              <Link
                href={hrefWith({ cat: "", mfr: "", page: "1" })}
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
                  href={hrefWith({ cat: g.category, mfr: "", page: "1" })}
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

            {manufacturers.length > 1 && (
              <div className="filter-group">
                <details open={Boolean(mfr)}>
                  <summary
                    style={{
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                      padding: "4px 0",
                      listStyle: "none",
                    }}
                  >
                    + Filter by manufacturer ({manufacturers.length} brand{manufacturers.length === 1 ? "" : "s"})
                  </summary>
                  <div style={{ marginTop: 8 }}>
                    <Link
                      href={hrefWith({ mfr: "", page: "1" })}
                      className="filter-opt"
                      style={{
                        fontWeight: mfr ? 400 : 700,
                        textDecoration: "none",
                        color: "inherit",
                      }}
                    >
                      All manufacturers
                      <span className="count">
                        {manufacturers.reduce((n, m) => n + m._count, 0)}
                      </span>
                    </Link>
                    {manufacturers.map((m) => (
                      <Link
                        key={m.manufacturer}
                        href={hrefWith({ mfr: m.manufacturer, page: "1" })}
                        className="filter-opt"
                        style={{
                          fontWeight: mfr === m.manufacturer ? 700 : 400,
                          textDecoration: "none",
                          color: mfr === m.manufacturer ? "var(--amber-deep)" : "inherit",
                        }}
                      >
                        {m.manufacturer}
                        <span className="count">{m._count}</span>
                      </Link>
                    ))}
                  </div>
                </details>
              </div>
            )}

            <div className="filter-group">
              <h2>Availability</h2>
              <Link
                href={hrefWith({ instock: inStock ? "" : "1", page: "1" })}
                className="filter-opt"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <input type="checkbox" readOnly checked={inStock} />
                In stock now
              </Link>
            </div>
            {(q || cat || mfr || inStock) && (
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
                    {aiSearch ? "Smart search" : "Search"} ·{" "}
                    <span className="ai-query">&ldquo;{q}&rdquo;</span>
                  </div>
                  <div className="ai-banner-text">
                    {interpretation}
                  </div>
                </div>
              </div>
            )}

            <div className="results-bar">
              <span className="results-count">
                {totalCount === 0 ? (
                  <>No parts match these filters</>
                ) : (
                  <>
                    Showing <strong>{(page - 1) * PAGE_SIZE + 1}</strong> to{" "}
                    <strong>
                      {Math.min(page * PAGE_SIZE, totalCount)}
                    </strong>{" "}
                    of <strong>{totalCount}</strong> result
                    {totalCount === 1 ? "" : "s"}
                  </>
                )}
              </span>
              <CatalogSort value={sort} />
            </div>

            {products.length === 0 ? (
              <div className="empty-block">
                <h2>No parts match your filters</h2>
                <p>
                  Try a different category, manufacturer, or{" "}
                  <Link href="/suppliers">request a part we don&rsquo;t list</Link>.
                </p>
              </div>
            ) : (
              <>
                <div className="product-grid">
                  {products.map((p) => (
                    <ProductCard key={p.sku} product={p} viewerCanBuy={viewerCanBuy} />
                  ))}
                </div>

                {totalPages > 1 && (
                  <nav
                    className="catalog-pager"
                    aria-label="Catalog pagination"
                  >
                    {page > 1 ? (
                      <Link
                        className="btn btn-ghost btn-sm"
                        href={hrefWith({ page: String(page - 1) })}
                      >
                        ← Previous
                      </Link>
                    ) : (
                      <span className="btn btn-ghost btn-sm" style={{ opacity: 0.4 }}>
                        ← Previous
                      </span>
                    )}
                    <span className="pager-numbers">
                      {pageWindow(page, totalPages).map((p, idx) =>
                        p === "…" ? (
                          <span
                            key={`gap-${idx}`}
                            className="pager-num pager-gap"
                            aria-hidden="true"
                          >
                            …
                          </span>
                        ) : p === page ? (
                          <span
                            key={p}
                            className="pager-num is-current"
                            aria-current="page"
                          >
                            {p}
                          </span>
                        ) : (
                          <Link
                            key={p}
                            className="pager-num"
                            href={hrefWith({ page: String(p) })}
                          >
                            {p}
                          </Link>
                        )
                      )}
                    </span>
                    {page < totalPages ? (
                      <Link
                        className="btn btn-ghost btn-sm"
                        href={hrefWith({ page: String(page + 1) })}
                      >
                        Next →
                      </Link>
                    ) : (
                      <span className="btn btn-ghost btn-sm" style={{ opacity: 0.4 }}>
                        Next →
                      </span>
                    )}
                  </nav>
                )}
              </>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

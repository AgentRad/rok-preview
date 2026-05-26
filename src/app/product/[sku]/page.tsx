import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { siteUrl } from "@/lib/site-url";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ProductImage from "@/components/ProductImage";
import ProductGallery from "@/components/ProductGallery";
import AddToCart from "@/components/AddToCart";
import FreightEstimateWidget from "@/components/FreightEstimateWidget";
import RequestQuote from "@/components/RequestQuote";
import Stars from "@/components/Stars";
import WriteReview from "@/components/WriteReview";
import { formatCents, FEE_RATE_LABEL } from "@/lib/money";
import { displayBuyerName, supplierRatingSummary } from "@/lib/reviews";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sku: string }>;
}): Promise<Metadata> {
  const { sku } = await params;
  const product = await prisma.product.findUnique({
    where: { sku },
    select: {
      name: true,
      manufacturer: true,
      description: true,
      imageUrl: true,
      active: true,
      supplier: { select: { status: true, publicVisible: true } },
    },
  });
  if (
    !product ||
    !product.active ||
    product.supplier.status !== "APPROVED" ||
    !product.supplier.publicVisible
  ) {
    return { title: "Part not found", robots: { index: false, follow: false } };
  }
  const title = `${product.name} (${product.manufacturer})`;
  const desc =
    (product.description || `Buy ${product.name} by ${product.manufacturer} on PartsPort. Vetted distributor, transparent pricing, delivery handled end to end.`).slice(0, 200);
  const url = siteUrl(`/product/${sku}`);
  const img = product.imageUrl || "/og-default.svg";
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
      images: [{ url: img, width: 1200, height: 630, alt: product.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | PartsPort`,
      description: desc,
      images: [img],
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const product = await prisma.product.findUnique({
    where: { sku },
    include: {
      supplier: {
        include: {
          warehouses: {
            orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
            take: 1,
          },
        },
      },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!product || !product.active) notFound();
  // Suppliers that haven't completed onboarding are hidden from buyers.
  // Catalog already filters them out; this is the deep-link safety net so
  // a stale URL doesn't expose an off-platform listing.
  if (
    product.supplier.status !== "APPROVED" ||
    !product.supplier.publicVisible
  ) {
    notFound();
  }

  const specs = product.specs as Record<string, string>;
  const inStock = product.stock > 0;
  const user = await getCurrentUser();

  const [reviews, ratingAgg, eligibleOrders, supplierRating] =
    await Promise.all([
      prisma.review.findMany({
        where: { productId: product.id, hiddenAt: null },
        orderBy: { createdAt: "desc" },
        take: 12,
        include: { buyer: { select: { name: true } } },
      }),
      prisma.review.aggregate({
        where: { productId: product.id, hiddenAt: null },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      user
        ? prisma.order.findMany({
            where: {
              buyerId: user.id,
              status: "FULFILLED",
              items: { some: { productId: product.id } },
            },
            select: { id: true, reference: true, paidAt: true },
            orderBy: { paidAt: "desc" },
          })
        : Promise.resolve([]),
      supplierRatingSummary(product.supplierId),
    ]);

  const reviewCount = ratingAgg._count._all;
  const reviewAverage = ratingAgg._avg.rating ?? 0;
  // Find any eligible order without an existing review yet.
  const reviewedOrderIds = user
    ? new Set(
        (
          await prisma.review.findMany({
            where: { buyerId: user.id, productId: product.id },
            select: { orderId: true },
          })
        ).map((r) => r.orderId)
      )
    : new Set<string>();
  const reviewableOrders = eligibleOrders.filter(
    (o) => !reviewedOrderIds.has(o.id)
  );
  const canReview = reviewableOrders.length > 0;

  const productJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    description: product.description || `${product.name} by ${product.manufacturer}`,
    brand: { "@type": "Brand", name: product.manufacturer },
    ...(product.imageUrl ? { image: [siteUrl(product.imageUrl)] } : {}),
    offers: {
      "@type": "Offer",
      url: siteUrl(`/product/${product.sku}`),
      priceCurrency: "USD",
      price: (product.priceCents / 100).toFixed(2),
      availability: product.quoteOnly
        ? "https://schema.org/InStoreOnly"
        : "https://schema.org/InStock",
      seller: { "@type": "Organization", name: product.supplier.name },
    },
    ...(reviewCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: reviewAverage.toFixed(2),
            reviewCount,
          },
        }
      : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <SiteHeader />
      <main id="main">
        <div className="detail">
          <div className="breadcrumb">
            <Link href="/">Home</Link> ›{" "}
            <Link href="/catalog">Catalog</Link> ›{" "}
            <Link href={`/catalog?cat=${encodeURIComponent(product.category)}`}>
              {product.category}
            </Link>{" "}
            › {product.sku}
          </div>
          <div className="detail-grid">
            <div
              className={
                "detail-gallery" + (product.images.length > 0 ? " has-gallery" : "")
              }
            >
              {product.images.length > 0 ? (
                <ProductGallery
                  images={product.images.map((i) => ({ id: i.id, url: i.url }))}
                  name={product.name}
                />
              ) : (
                <ProductImage
                  imageUrl={product.imageUrl}
                  icon={product.icon}
                  name={product.name}
                />
              )}
            </div>
            <div>
              <div className="detail-mfr">{product.manufacturer}</div>
              <h1>{product.name}</h1>
              <div className="detail-rating">
                {reviewCount > 0 ? (
                  <>
                    <Stars value={reviewAverage} />
                    <span>
                      {reviewAverage.toFixed(1)} ({reviewCount} verified review
                      {reviewCount === 1 ? "" : "s"})
                    </span>
                    <span>·</span>
                    <span>SKU {product.sku}</span>
                  </>
                ) : (
                  <>
                    <span className="muted-text">No reviews yet</span>
                    <span>·</span>
                    <span>SKU {product.sku}</span>
                  </>
                )}
              </div>
              <div className="detail-price">
                {product.quoteOnly ? (
                  <>
                    {formatCents(product.priceCents)}{" "}
                    <span className="unit">indicative / {product.unit}</span>
                  </>
                ) : (
                  <>
                    {formatCents(product.priceCents)}{" "}
                    <span className="unit">/ {product.unit}</span>
                  </>
                )}
              </div>

              <div className="detail-buybox">
                <div className="buybox-row">
                  <span>{product.quoteOnly ? "Typical lead time" : "Delivery ETA"}</span>
                  <span className="v" style={{ color: "var(--green)" }}>
                    {product.etaDays} business day{product.etaDays > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="buybox-row">
                  <span>Availability</span>
                  <span
                    className="v"
                    style={{
                      color: product.quoteOnly
                        ? "var(--ink)"
                        : inStock
                          ? "var(--green)"
                          : "#b4431f",
                    }}
                  >
                    {product.quoteOnly
                      ? "Made to order"
                      : inStock
                        ? `${product.stock.toLocaleString()} in stock`
                        : "Backorder"}
                  </span>
                </div>
                <div className="buybox-row">
                  <span>Sold &amp; fulfilled by</span>
                  <span className="v" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {product.supplier.logoUrl && (
                      <Image
                        className="supplier-logo-inline"
                        src={product.supplier.logoUrl}
                        alt=""
                        width={18}
                        height={18}
                        unoptimized
                      />
                    )}
                    {product.supplier.name}{" "}
                    {supplierRating.kind === "computed" ? (
                      <>★ {supplierRating.average.toFixed(1)} ({supplierRating.count})</>
                    ) : (
                      <span className="muted-text" style={{ fontSize: 12 }}>
                        · New supplier
                      </span>
                    )}
                  </span>
                </div>

                {/* Purchase affordances only for buyer-eligible viewers
                    (anonymous shoppers, BUYER role, ADMIN for testing).
                    OEMs and suppliers are explicitly excluded from the
                    buy flow per the platform's no-channel-conflict
                    business rule. */}
                {user?.role === "MANUFACTURER" ? (
                  <div className="alert alert-info" style={{ marginTop: 18 }}>
                    <strong>Distributors carry this part.</strong> Orders
                    route to {product.supplier.name}; manufacturers don&rsquo;t
                    purchase through PartsPort. View your storefront on{" "}
                    <Link
                      href="/oem"
                      style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
                    >
                      /oem
                    </Link>{" "}
                    to see how buyers find your brand.
                  </div>
                ) : user?.role === "SUPPLIER" ? (
                  <div className="alert alert-info" style={{ marginTop: 18 }}>
                    <strong>Suppliers fulfill, don&rsquo;t buy.</strong>{" "}
                    Sign in as a buyer account to test the purchase flow.
                  </div>
                ) : product.quoteOnly ? (
                  <div style={{ marginTop: 18 }}>
                    <RequestQuote
                      sku={product.sku}
                      user={user ? { name: user.name, email: user.email } : null}
                    />
                  </div>
                ) : (
                  <AddToCart sku={product.sku} inStock={inStock} />
                )}

                <div className="fee-note">
                  {product.quoteOnly
                    ? `Configured equipment is priced by a vetted supplier. The order, payment, and delivery all run through PartsPort, with a ${FEE_RATE_LABEL} marketplace fee included.`
                    : `PartsPort verifies the supplier, handles payment, and delivers the part. A ${FEE_RATE_LABEL} marketplace fee is added at checkout. You are not charged until you pay.`}
                </div>
                {!product.quoteOnly &&
                  product.weightLbs != null &&
                  product.supplier.warehouses.length > 0 && (
                    <FreightEstimateWidget sku={product.sku} />
                  )}
              </div>
            </div>
          </div>

          <div className="detail-specs">
            <h2>Specifications</h2>
            <table className="spec-table">
              <tbody>
                {Object.entries(specs).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="detail-desc">{product.description}</div>
          </div>

          <div className="reviews-section">
            <div className="reviews-head">
              <h2>Reviews</h2>
              {reviewCount > 0 && (
                <div className="reviews-summary">
                  <Stars value={reviewAverage} size={16} />
                  <span style={{ fontWeight: 700 }}>
                    {reviewAverage.toFixed(1)}
                  </span>
                  <span className="muted-text" style={{ fontSize: 13 }}>
                    {reviewCount} verified review
                    {reviewCount === 1 ? "" : "s"}
                  </span>
                </div>
              )}
            </div>

            {canReview && reviewableOrders[0] && (
              <div className="review-card-write">
                <div
                  className="invoice-meta-label"
                  style={{ marginBottom: 8 }}
                >
                  Write a review for order {reviewableOrders[0].reference}
                </div>
                <WriteReview
                  productId={product.id}
                  orderId={reviewableOrders[0].id}
                />
              </div>
            )}

            {!canReview && user && eligibleOrders.length === 0 && (
              <p className="muted-text" style={{ fontSize: 13.5 }}>
                Reviews are open to buyers with a delivered order for this
                part. Once your order is marked Delivered, you will see the
                review form here.
              </p>
            )}
            {!canReview && user && eligibleOrders.length > 0 && (
              <p className="muted-text" style={{ fontSize: 13.5 }}>
                Thanks for your review. You can review this part again on a
                future delivered order.
              </p>
            )}
            {!user && (
              <p className="muted-text" style={{ fontSize: 13.5 }}>
                <Link
                  href="/login"
                  style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
                >
                  Sign in
                </Link>{" "}
                to write a review after a delivered order.
              </p>
            )}

            {reviews.length === 0 ? (
              <div className="empty-block" style={{ marginTop: 18 }}>
                <h3>No reviews yet</h3>
                <p>Verified reviews appear here after delivered orders.</p>
              </div>
            ) : (
              <ul className="review-list">
                {reviews.map((r) => (
                  <li key={r.id} className="review-item">
                    <div className="review-meta">
                      <Stars value={r.rating} />
                      <strong style={{ fontSize: 14 }}>
                        {displayBuyerName(r.buyer.name)}
                      </strong>
                      <span className="verified-badge">Verified buyer</span>
                      <span className="muted-text" style={{ fontSize: 12.5 }}>
                        {r.createdAt.toLocaleDateString()}
                      </span>
                    </div>
                    {r.title && (
                      <div style={{ marginTop: 6, fontWeight: 600, fontSize: 14.5 }}>
                        {r.title}
                      </div>
                    )}
                    {r.body && (
                      <p style={{ marginTop: 6, fontSize: 14, lineHeight: 1.55 }}>
                        {r.body}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ marginTop: 28 }}>
            <Link href="/catalog" className="btn btn-ghost btn-sm">
              ← Back to all parts
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

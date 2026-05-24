import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ProductImage from "@/components/ProductImage";
import ProductGallery from "@/components/ProductGallery";
import AddToCart from "@/components/AddToCart";
import RequestQuote from "@/components/RequestQuote";
import Stars from "@/components/Stars";
import WriteReview from "@/components/WriteReview";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const product = await prisma.product.findUnique({
    where: { sku },
    include: {
      supplier: true,
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!product || !product.active) notFound();

  const specs = product.specs as Record<string, string>;
  const inStock = product.stock > 0;
  const user = await getCurrentUser();

  const [reviews, ratingAgg, ownReview, eligibleOrder] = await Promise.all([
    prisma.review.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { buyer: { select: { name: true } } },
    }),
    prisma.review.aggregate({
      where: { productId: product.id },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    user
      ? prisma.review.findUnique({
          where: { buyerId_productId: { buyerId: user.id, productId: product.id } },
        })
      : Promise.resolve(null),
    user
      ? prisma.order.findFirst({
          where: {
            buyerId: user.id,
            status: "FULFILLED",
            items: { some: { productId: product.id } },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  const reviewCount = ratingAgg._count._all;
  const reviewAverage = ratingAgg._avg.rating ?? 0;
  const canReview = !!user && !!eligibleOrder;

  return (
    <>
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
            <div className="detail-gallery">
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
                  <span className="v">
                    {product.supplier.name} ★ {product.supplier.rating.toFixed(1)}
                  </span>
                </div>

                {product.quoteOnly ? (
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
                    ? "Configured equipment is priced by a vetted supplier. The order, payment, and delivery all run through PartsPort, with the marketplace fee included."
                    : "PartsPort verifies the supplier, handles payment, and delivers the part. The marketplace fee is added at checkout. You are not charged until you pay."}
                </div>
              </div>
            </div>
          </div>

          <div className="detail-specs">
            <h3>Specifications</h3>
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
              <h3>Reviews</h3>
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

            {canReview && (
              <div className="review-card-write">
                <div
                  className="invoice-meta-label"
                  style={{ marginBottom: 8 }}
                >
                  {ownReview ? "Update your review" : "Write a review"}
                </div>
                <WriteReview
                  productId={product.id}
                  initialRating={ownReview?.rating ?? 0}
                  initialBody={ownReview?.body ?? ""}
                />
              </div>
            )}

            {!canReview && user && (
              <p className="muted-text" style={{ fontSize: 13.5 }}>
                Reviews are open to buyers with a delivered order for this
                part. Once your order is marked Delivered, you will see the
                review form here.
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
                      <strong style={{ fontSize: 14 }}>{r.buyer.name}</strong>
                      <span className="muted-text" style={{ fontSize: 12.5 }}>
                        {r.createdAt.toLocaleDateString()}
                      </span>
                    </div>
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

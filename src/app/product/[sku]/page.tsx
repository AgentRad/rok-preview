import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ProductImage from "@/components/ProductImage";
import AddToCart from "@/components/AddToCart";
import RequestQuote from "@/components/RequestQuote";
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
    include: { supplier: true },
  });
  if (!product || !product.active) notFound();

  const specs = product.specs as Record<string, string>;
  const inStock = product.stock > 0;
  const user = await getCurrentUser();

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
              <ProductImage
                imageUrl={product.imageUrl}
                icon={product.icon}
                name={product.name}
              />
            </div>
            <div>
              <div className="detail-mfr">{product.manufacturer}</div>
              <h1>{product.name}</h1>
              <div className="detail-rating">
                <span className="rating">★ {product.supplier.rating.toFixed(1)}</span>
                <span>{product.supplier.reviews} verified reviews</span>
                <span>·</span>
                <span>SKU {product.sku}</span>
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
                    ? "Configured equipment is priced by a vetted supplier. The order, payment, and delivery all run through PartsPort, with a 4% service fee included."
                    : "PartsPort verifies the supplier, handles payment, and delivers the part. A 4% service fee is added at checkout. You are not charged until you pay."}
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

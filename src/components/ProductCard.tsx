import Link from "next/link";
import Image from "next/image";
import ProductImage from "./ProductImage";
import QuickAddButton from "./QuickAddButton";
import { formatCents } from "@/lib/money";
import { primaryImageUrl } from "@/lib/product-images";

export type CardProduct = {
  sku: string;
  name: string;
  category: string;
  manufacturer: string;
  icon: string;
  imageUrl?: string | null;
  images?: { url: string; ordinal?: number }[];
  priceCents: number;
  unit: string;
  etaDays: number;
  stock: number;
  quoteOnly: boolean;
  imageCount?: number;
  _count?: { images?: number };
  supplierId: string;
  supplier: { name: string; rating: number; logoUrl?: string | null };
};

export default function ProductCard({
  product,
  viewerCanBuy = true,
}: {
  product: CardProduct;
  /** When false (OEM / supplier viewer), the QuickAdd CTA is hidden so the
   *  catalog card matches the gated buy flow on the detail page. Default
   *  true keeps existing pages (homepage featured, brand storefront)
   *  rendering normally for anonymous / buyer / admin viewers. */
  viewerCanBuy?: boolean;
}) {
  const imageCount = product.imageCount ?? product._count?.images ?? 0;
  return (
    <div className="product-card">
      <Link className="product-card-link" href={`/product/${product.sku}`}>
        <div className="product-thumb">
          <span className="thumb-badge">{product.category}</span>
          {imageCount > 1 ? (
            <span className="thumb-count">+{imageCount - 1}</span>
          ) : null}
          <ProductImage
            imageUrl={primaryImageUrl(product)}
            icon={product.icon}
            name={product.name}
          />
        </div>
        <div className="product-body">
          <div className="product-mfr">{product.manufacturer}</div>
          <div className="product-name">{product.name}</div>
          <div className="product-meta">
            <div className="product-price">
              {formatCents(product.priceCents)}{" "}
              <span className="unit">/ {product.unit}</span>
            </div>
            <div className="product-sub">
              <span className="dot rating">★ {product.supplier.rating.toFixed(1)}</span>
              {product.quoteOnly ? (
                <span className="dot quote-tag">By quote</span>
              ) : product.stock > 0 ? (
                <span className="dot eta">
                  Delivery in {product.etaDays} day{product.etaDays > 1 ? "s" : ""}
                </span>
              ) : (
                <span className="dot stock-out">Backorder</span>
              )}
            </div>
            <div className="product-sub product-supplier">
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
              <span>Sold by {product.supplier.name}</span>
            </div>
          </div>
        </div>
      </Link>
      {viewerCanBuy && (
        <div className="product-action">
          <QuickAddButton
            sku={product.sku}
            quoteOnly={product.quoteOnly}
            supplierId={product.supplierId}
            supplierName={product.supplier.name}
          />
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import ProductImage from "./ProductImage";
import { formatCents } from "@/lib/money";

export type CardProduct = {
  sku: string;
  name: string;
  category: string;
  manufacturer: string;
  icon: string;
  imageUrl?: string | null;
  priceCents: number;
  unit: string;
  etaDays: number;
  stock: number;
  quoteOnly: boolean;
  supplier: { name: string; rating: number };
};

export default function ProductCard({ product }: { product: CardProduct }) {
  return (
    <Link className="product-card" href={`/product/${product.sku}`}>
      <div className="product-thumb">
        <span className="thumb-badge">{product.category}</span>
        <ProductImage
          imageUrl={product.imageUrl}
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
          <div className="product-sub">
            <span>Sold by {product.supplier.name}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

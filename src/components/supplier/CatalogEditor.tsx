import Link from "next/link";
import SupplierProductManager from "@/components/SupplierProductManager";
import CatalogCsvImport from "@/components/CatalogCsvImport";

type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  manufacturer: string;
  priceCents: number;
  unit: string;
  etaDays: number;
  stock: number;
  active: boolean;
  imageUrl: string | null;
  weightLbs: number | null;
  freightClass: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
};

// PLH-3l P2: extracted from /supplier/page.tsx catalog blocks.
// Renders the existing SupplierProductManager + AI import tile + CSV import.
export default function CatalogEditor({
  products,
  manufacturers,
  showExports,
}: {
  products: Product[];
  manufacturers: string[];
  showExports: boolean;
}) {
  return (
    <>
      <SupplierProductManager products={products} manufacturers={manufacturers} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h2>Import catalog with AI</h2>
          <Link
            href="/supplier/catalog-import"
            className="btn btn-primary btn-sm"
          >
            Open assistant
          </Link>
        </div>
        <div className="card-body">
          <p className="muted-text" style={{ fontSize: 13, margin: 0 }}>
            Paste any sheet (CSV, TSV, or .xlsx). The AI maps your columns to
            the PartsPort schema, you chat to refine the rules, then click
            Import. Nothing goes live until you do.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Bulk catalog import (CSV)</h2>
          {showExports && (
            <a
              href="/api/supplier/orders.csv"
              className="btn btn-ghost btn-sm"
              download
            >
              Export your orders (CSV)
            </a>
          )}
        </div>
        <div className="card-body">
          <CatalogCsvImport />
        </div>
      </div>
    </>
  );
}

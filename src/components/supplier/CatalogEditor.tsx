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
  const isEmpty = products.length === 0;
  return (
    <>
      {isEmpty && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <h2>Upload your first catalog in 5 minutes</h2>
            <Link
              href="/supplier/catalog-import"
              className="btn btn-primary btn-sm"
            >
              Open AI import
            </Link>
          </div>
          <div className="card-body">
            <p style={{ margin: 0, fontSize: 14 }}>
              The AI import will map your columns to PartsPort fields. Paste
              any sheet (CSV, TSV, or .xlsx), refine the mapping, then click
              Import.
            </p>
            <p
              className="muted-text"
              style={{ fontSize: 12.5, marginTop: 10, marginBottom: 0 }}
            >
              Suppliers with 10+ SKUs receive RFQs within 7 days on average.
            </p>
          </div>
        </div>
      )}

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

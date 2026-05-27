import { getCurrentUser } from "@/lib/auth";
import {
  canEditCatalog,
  canRunExports,
  getActiveSupplierContext,
} from "@/lib/supplier-access";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SupplierNav from "@/components/SupplierNav";
import ActingAsBanner from "@/components/ActingAsBanner";
import { listClaimedManufacturers } from "@/lib/manufacturers";
import { loadSupplierWithProducts } from "@/components/supplier/data";
import CatalogEditor from "@/components/supplier/CatalogEditor";

export const dynamic = "force-dynamic";

// PLH-3l P3: catalog management sub-route.
export default async function SupplierProductsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPPLIER" && user.role !== "ADMIN") redirect("/");
  const ctx = await getActiveSupplierContext(user);
  const role = ctx?.role ?? null;
  if (!canEditCatalog(role)) redirect("/supplier");
  const showExports = canRunExports(role);
  const supplier = ctx ? await loadSupplierWithProducts(ctx.supplier.id) : null;
  const claimedManufacturers = await listClaimedManufacturers();

  return (
    <>
      <SiteHeader />
      <SupplierNav active="products" />
      <main id="main" className="app-page">
        <div className="page-pad">
          {ctx?.actingAsAdmin && (
            <ActingAsBanner supplierName={ctx.supplier.name} />
          )}
          <h1 className="page-title">Products</h1>
          <p className="page-sub">Manage your catalog.</p>
          {supplier ? (
            <CatalogEditor
              products={supplier.products.map((p) => ({
                id: p.id,
                sku: p.sku,
                name: p.name,
                category: p.category,
                manufacturer: p.manufacturer,
                priceCents: p.priceCents,
                unit: p.unit,
                etaDays: p.etaDays,
                stock: p.stock,
                active: p.active,
                imageUrl: p.imageUrl,
                weightLbs: p.weightLbs,
                freightClass: p.freightClass,
                lengthIn: p.lengthIn,
                widthIn: p.widthIn,
                heightIn: p.heightIn,
              }))}
              manufacturers={claimedManufacturers}
              showExports={showExports}
            />
          ) : (
            <div className="alert alert-info" style={{ marginTop: 16 }}>
              No supplier profile is linked to this account.
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

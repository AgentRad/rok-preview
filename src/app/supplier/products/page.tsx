import { getCurrentUser } from "@/lib/auth";
import { getActiveSupplierContext } from "@/lib/supplier-access";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SupplierNav from "@/components/SupplierNav";
import ActingAsBanner from "@/components/ActingAsBanner";

export const dynamic = "force-dynamic";

// PLH-3l P1: sub-route placeholder. Real section components wired in P3.
export default async function SupplierProductsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPPLIER" && user.role !== "ADMIN") redirect("/");
  const ctx = await getActiveSupplierContext(user);

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
          <p className="page-sub">Catalog management.</p>
          <div className="alert alert-info" style={{ marginTop: 16 }}>
            Wired in PLH-3l P3.
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

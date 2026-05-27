import { getCurrentUser } from "@/lib/auth";
import {
  canRespondToQuotes,
  canViewQuotes,
  getActiveSupplierContext,
} from "@/lib/supplier-access";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SupplierNav from "@/components/SupplierNav";
import ActingAsBanner from "@/components/ActingAsBanner";
import { loadSupplierQuotes } from "@/components/supplier/data";
import QuoteRequestsTable from "@/components/supplier/QuoteRequestsTable";

export const dynamic = "force-dynamic";

// PLH-3l P3: quotes sub-route.
export default async function SupplierQuotesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPPLIER" && user.role !== "ADMIN") redirect("/");
  const ctx = await getActiveSupplierContext(user);
  const role = ctx?.role ?? null;
  if (!canViewQuotes(role)) redirect("/supplier");
  const canRespond = canRespondToQuotes(role);
  const quotes = ctx ? await loadSupplierQuotes(ctx.supplier.id) : [];

  return (
    <>
      <SiteHeader />
      <SupplierNav active="quotes" />
      <main id="main" className="app-page">
        <div className="page-pad">
          {ctx?.actingAsAdmin && (
            <ActingAsBanner supplierName={ctx.supplier.name} />
          )}
          <h1 className="page-title">Quote requests</h1>
          <p className="page-sub">Respond to buyer RFQs.</p>
          {ctx ? (
            <QuoteRequestsTable quotes={quotes} canRespond={canRespond} />
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

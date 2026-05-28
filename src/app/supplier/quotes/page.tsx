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
import Link from "next/link";
import { loadSupplierQuotes } from "@/components/supplier/data";
import QuoteRequestsTable from "@/components/supplier/QuoteRequestsTable";
import { getUnreadCounts } from "@/lib/messages";

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
  // PLH-3p F4: small red dot next to RFQ rows with unread messages.
  const unread = await getUnreadCounts(user.id);
  const unreadByQuoteId: Record<string, number> = {};
  for (const [key, n] of unread.byThread) {
    if (key.startsWith("quote:")) {
      unreadByQuoteId[key.slice("quote:".length)] = n;
    }
  }

  return (
    <>
      <SiteHeader />
      <SupplierNav active="quotes" sticky />
      <main id="main" className="app-page">
        <div className="page-pad">
          {ctx?.actingAsAdmin && (
            <ActingAsBanner supplierName={ctx.supplier.name} />
          )}
          <div className="breadcrumb">
            <Link href="/supplier">Supplier</Link> → Quotes
          </div>
          <h1 className="page-title">Quote requests</h1>
          <p className="page-sub">Respond to buyer RFQs.</p>
          {ctx ? (
            <QuoteRequestsTable
              quotes={quotes}
              canRespond={canRespond}
              unreadByQuoteId={unreadByQuoteId}
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

import { getCurrentUser } from "@/lib/auth";
import {
  canViewPayouts,
  getActiveSupplierContext,
} from "@/lib/supplier-access";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SupplierNav from "@/components/SupplierNav";
import ActingAsBanner from "@/components/ActingAsBanner";
import Link from "next/link";
import {
  loadSupplierWithProducts,
  loadSupplierPayouts,
  loadSupplierReserveTxns,
} from "@/components/supplier/data";
import ReserveBalanceCard from "@/components/supplier/ReserveBalanceCard";
import PayoutsTable from "@/components/supplier/PayoutsTable";

export const dynamic = "force-dynamic";

// PLH-3l P3: payouts sub-route.
export default async function SupplierPayoutsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPPLIER" && user.role !== "ADMIN") redirect("/");
  const ctx = await getActiveSupplierContext(user);
  const role = ctx?.role ?? null;
  if (!canViewPayouts(role)) redirect("/supplier");
  const supplier = ctx ? await loadSupplierWithProducts(ctx.supplier.id) : null;

  return (
    <>
      <SiteHeader />
      <SupplierNav active="payouts" sticky />
      <main id="main" className="app-page">
        <div className="page-pad">
          {ctx?.actingAsAdmin && (
            <ActingAsBanner supplierName={ctx.supplier.name} />
          )}
          <div className="breadcrumb">
            <Link href="/supplier">Supplier</Link> → Payouts
          </div>
          <h1 className="page-title">Payouts</h1>
          <p className="page-sub">Reserve, balance, and payout history.</p>
          {supplier ? (
            <>
              <ReserveBalanceCard
                reserveBalanceCents={supplier.reserveBalanceCents}
                owedToPlatformCents={supplier.owedToPlatformCents}
                reservePercent={supplier.reservePercent}
                reserveTxns={await loadSupplierReserveTxns(supplier.id)}
              />
              <PayoutsTable payouts={await loadSupplierPayouts(supplier.id)} />
            </>
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

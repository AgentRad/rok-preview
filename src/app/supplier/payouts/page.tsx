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
              {await (async () => {
                const payouts = await loadSupplierPayouts(supplier.id);
                return (
                  <>
                    {payouts.length === 0 && (
                      <div
                        className="alert alert-info"
                        style={{ marginTop: 16 }}
                      >
                        Payouts run every Friday for orders fulfilled the prior
                        week. PartsPort holds a 5% reserve against returns and
                        chargebacks; the reserve releases after the
                        30-day return window closes. Your first payout appears
                        here once your first paid order ships.
                      </div>
                    )}
                    <PayoutsTable payouts={payouts} />
                  </>
                );
              })()}
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

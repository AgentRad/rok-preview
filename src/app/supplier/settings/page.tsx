import { getCurrentUser } from "@/lib/auth";
import { getActiveSupplierContext } from "@/lib/supplier-access";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SupplierNav from "@/components/SupplierNav";
import ActingAsBanner from "@/components/ActingAsBanner";
import { isBlobConfigured } from "@/lib/blob-config";
import {
  loadSupplierWithProducts,
  loadSupplierDocuments,
  loadSupplierWarehouses,
  computeSupplierReadiness,
  getConnectSnap,
} from "@/components/supplier/data";
import CompanyLogoEditor from "@/components/supplier/CompanyLogoEditor";
import LegalDocsEditor from "@/components/supplier/LegalDocsEditor";
import WarehousesEditor from "@/components/supplier/WarehousesEditor";
import PayoutMethodEditor from "@/components/supplier/PayoutMethodEditor";
import TeamManager from "@/components/supplier/TeamManager";
import GoLiveReadiness from "@/components/supplier/GoLiveReadiness";

export const dynamic = "force-dynamic";

// PLH-3l P3: settings sub-route. Holds the full go-live readiness checklist
// so veterans can still review every gate from one place.
export default async function SupplierSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ stripeOnboard?: string }>;
}) {
  const sp = await searchParams;
  const stripeOnboardSuccess = sp.stripeOnboard === "done";
  const stripeOnboardRefresh = sp.stripeOnboard === "refresh";
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPPLIER" && user.role !== "ADMIN") redirect("/");
  const ctx = await getActiveSupplierContext(user);
  const supplier = ctx ? await loadSupplierWithProducts(ctx.supplier.id) : null;
  const blobOk = isBlobConfigured();

  if (!supplier) {
    return (
      <>
        <SiteHeader />
        <SupplierNav active="settings" />
        <main id="main" className="app-page">
          <div className="page-pad narrow">
            <h1 className="page-title">Settings</h1>
            <div className="alert alert-info" style={{ marginTop: 16 }}>
              No supplier profile is linked to this account.
            </div>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const [documents, warehouses] = await Promise.all([
    loadSupplierDocuments(supplier.id),
    loadSupplierWarehouses(supplier.id),
  ]);
  const readiness = computeSupplierReadiness(supplier, documents);
  const connectSnap = getConnectSnap(supplier);

  return (
    <>
      <SiteHeader />
      <SupplierNav active="settings" />
      <main id="main" className="app-page">
        <div className="page-pad">
          {ctx?.actingAsAdmin && (
            <ActingAsBanner supplierName={supplier.name} />
          )}
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Company profile, legal, warehouses, payout method, team.</p>

          <GoLiveReadiness
            readiness={readiness}
            publicVisible={supplier.publicVisible}
          />

          <CompanyLogoEditor
            logoUrl={supplier.logoUrl}
            supplierName={supplier.name}
            blobConfigured={blobOk}
          />

          <LegalDocsEditor documents={documents} blobConfigured={blobOk} />

          <WarehousesEditor warehouses={warehouses} />

          <PayoutMethodEditor
            connectSnap={connectSnap}
            successFlag={stripeOnboardSuccess}
            refreshFlag={stripeOnboardRefresh}
            legacyBank={{
              show:
                supplier.bankInfoStatus === "ON_FILE" && !connectSnap.active,
              bankInfoStatus: supplier.bankInfoStatus,
              bankInfoLast4: supplier.bankInfoLast4,
              bankInfoType: supplier.bankInfoType,
              bankInfoBankName: supplier.bankInfoBankName,
              bankInfoNote: supplier.bankInfoNote,
              bankInfoUpdatedAt: supplier.bankInfoUpdatedAt
                ? supplier.bankInfoUpdatedAt.toISOString()
                : null,
            }}
          />

          <TeamManager />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

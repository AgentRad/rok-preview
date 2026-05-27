import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  ROLE_LABEL,
  canEditCatalog,
  canFulfillOrders,
  canRespondToQuotes,
  canRunExports,
  canViewOrders,
  canViewPayouts,
  canViewQuotes,
  getActiveSupplierContext,
} from "@/lib/supplier-access";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SupplierNav from "@/components/SupplierNav";
import ActingAsBanner from "@/components/ActingAsBanner";
import SupplierAIAssistant from "@/components/SupplierAIAssistant";
import { isBlobConfigured } from "@/lib/blob-config";
import { listClaimedManufacturers } from "@/lib/manufacturers";
import { getSupplierAttention } from "@/lib/attention";

import {
  loadSupplierWithProducts,
  loadSupplierDocuments,
  loadSupplierWarehouses,
  loadSupplierOrders,
  loadSupplierQuotes,
  loadSupplierPayouts,
  loadSupplierReserveTxns,
  computeSupplierReadiness,
  getConnectSnap,
} from "@/components/supplier/data";
import StatsRow from "@/components/supplier/StatsRow";
import AttentionPanel from "@/components/supplier/AttentionPanel";
import GoLiveReadiness from "@/components/supplier/GoLiveReadiness";
import CompanyLogoEditor from "@/components/supplier/CompanyLogoEditor";
import LegalDocsEditor from "@/components/supplier/LegalDocsEditor";
import WarehousesEditor from "@/components/supplier/WarehousesEditor";
import PayoutMethodEditor from "@/components/supplier/PayoutMethodEditor";
import CatalogEditor from "@/components/supplier/CatalogEditor";
import TeamManager from "@/components/supplier/TeamManager";
import ReserveBalanceCard from "@/components/supplier/ReserveBalanceCard";
import PayoutsTable from "@/components/supplier/PayoutsTable";
import QuoteRequestsTable from "@/components/supplier/QuoteRequestsTable";
import IncomingOrdersTable from "@/components/supplier/IncomingOrdersTable";

export const dynamic = "force-dynamic";

export default async function SupplierDashboard({
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
  const role = ctx?.role ?? null;
  const supplier = ctx ? await loadSupplierWithProducts(ctx.supplier.id) : null;

  const showCatalog = canEditCatalog(role);
  const showQuotes = canViewQuotes(role);
  const canRespond = canRespondToQuotes(role);
  const showOrders = canViewOrders(role);
  const canFulfill = canFulfillOrders(role);
  const showPayouts = canViewPayouts(role);
  const showExports = canRunExports(role);

  if (!supplier) {
    return (
      <>
        <SiteHeader />
        <SupplierNav active="dashboard" />
        <main id="main" className="app-page">
          <div className="page-pad narrow">
            <h1 className="page-title">Supplier dashboard</h1>
            <div className="alert alert-info" style={{ marginTop: 16 }}>
              {user.role === "ADMIN"
                ? "No supplier selected. Go to /admin and click 'Manage as' next to a supplier to operate their dashboard."
                : "No supplier profile is linked to this account yet. Once an admin approves your supplier application, your dashboard appears here."}
            </div>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const [orders, quotes, payouts, attention, documents, warehouses, reserveTxns] =
    await Promise.all([
      loadSupplierOrders(supplier.id),
      loadSupplierQuotes(supplier.id),
      loadSupplierPayouts(supplier.id),
      getSupplierAttention(supplier.id),
      loadSupplierDocuments(supplier.id),
      loadSupplierWarehouses(supplier.id),
      loadSupplierReserveTxns(supplier.id),
    ]);

  const claimedManufacturers = showCatalog ? await listClaimedManufacturers() : [];

  const readiness = computeSupplierReadiness(supplier, documents);
  const connectSnap = getConnectSnap(supplier);

  // PLH-3g P8: revenue from supplier's slot subtotal when present.
  let revenue = 0;
  for (const o of orders) {
    const slot = o.supplierSlots[0];
    if (slot) {
      revenue += slot.subtotalCents;
      continue;
    }
    for (const it of o.items) {
      if (it.product.supplierId === supplier.id)
        revenue += it.unitPriceCents * it.qty;
    }
  }
  const unitsInStock = supplier.products.reduce((s, p) => s + p.stock, 0);
  const activeListings = supplier.products.filter((p) => p.active).length;
  const blobOk = isBlobConfigured();

  return (
    <>
      <SiteHeader />
      <SupplierNav active="dashboard" />
      <main id="main" className="app-page">
        <div className="page-pad">
          {ctx?.actingAsAdmin && (
            <ActingAsBanner supplierName={supplier.name} />
          )}
          <h1 className="page-title">{supplier.name}</h1>
          <p className="page-sub">
            Supplier dashboard · ★ {supplier.rating.toFixed(1)} ·{" "}
            {supplier.onTimeRate.toFixed(1)}% on-time
            {role
              ? ` · ${ctx?.actingAsAdmin ? "Admin override" : "Signed in as " + ROLE_LABEL[role]}`
              : ""}
          </p>

          <StatsRow
            activeListings={activeListings}
            totalListings={supplier.products.length}
            unitsInStock={unitsInStock}
            ordersCount={orders.length}
            revenueCents={revenue}
          />

          <SupplierAIAssistant enabled={Boolean(process.env.ANTHROPIC_API_KEY)} />

          <AttentionPanel items={attention} />

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

          {showCatalog && (
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
          )}

          <TeamManager />

          {showPayouts && (
            <ReserveBalanceCard
              reserveBalanceCents={supplier.reserveBalanceCents}
              owedToPlatformCents={supplier.owedToPlatformCents}
              reservePercent={supplier.reservePercent}
              reserveTxns={reserveTxns}
            />
          )}

          {showPayouts && <PayoutsTable payouts={payouts} />}

          {showQuotes && (
            <QuoteRequestsTable quotes={quotes} canRespond={canRespond} />
          )}

          {showOrders && (
            <IncomingOrdersTable
              orders={orders}
              supplierId={supplier.id}
              canFulfill={canFulfill}
            />
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

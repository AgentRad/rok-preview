import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  ROLE_LABEL,
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
import SummarizeRfqsTile from "@/components/SummarizeRfqsTile";
import { getSupplierAttention } from "@/lib/attention";

import {
  loadSupplierWithProducts,
  loadSupplierDocuments,
  loadSupplierOrders,
  loadSupplierQuotes,
  loadSupplierPayouts,
  computeSupplierReadiness,
} from "@/components/supplier/data";
import StatsRow from "@/components/supplier/StatsRow";
import AttentionPanel from "@/components/supplier/AttentionPanel";
import GoLiveReadiness from "@/components/supplier/GoLiveReadiness";
import CompactTiles from "@/components/supplier/CompactTiles";

export const dynamic = "force-dynamic";

// PLH-3l P4: dashboard trimmed to daily ops. Editor cards (logo, legal docs,
// warehouses, payout method, catalog, team), the full reserve/payouts table
// and the full quotes/orders tables now live under their sub-routes. The
// dashboard shows status + attention + AI tile + compact tiles linking out.
export default async function SupplierDashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPPLIER" && user.role !== "ADMIN") redirect("/");

  const ctx = await getActiveSupplierContext(user);
  const role = ctx?.role ?? null;
  const supplier = ctx ? await loadSupplierWithProducts(ctx.supplier.id) : null;

  const showQuotes = canViewQuotes(role);
  const showOrders = canViewOrders(role);
  const showPayouts = canViewPayouts(role);

  if (!supplier) {
    return (
      <>
        <SiteHeader />
        <SupplierNav active="dashboard" sticky />
        <main id="main" className="app-page">
          <div className="page-pad narrow">
            <h1 className="page-title">Supplier dashboard</h1>
            {user.role === "ADMIN" ? (
              <div className="alert alert-info" style={{ marginTop: 16 }}>
                No supplier selected. Go to /admin and click &lsquo;Manage as&rsquo; next to a supplier to operate their dashboard.
              </div>
            ) : (
              <div className="alert alert-info" style={{ marginTop: 16 }}>
                <p style={{ margin: 0 }}>
                  No supplier profile is linked to this account yet. Apply to
                  become a PartsPort distributor and your dashboard appears
                  here once approved.
                </p>
                <p style={{ marginTop: 10, marginBottom: 0 }}>
                  <a className="btn btn-primary btn-sm" href="/suppliers#apply">
                    Apply to become a supplier
                  </a>
                </p>
                <p
                  className="muted-text"
                  style={{ marginTop: 10, marginBottom: 0, fontSize: 12.5 }}
                >
                  Most applications reviewed within 2 business days. Questions?
                  Email <a href="mailto:rad@agentgaming.gg">rad@agentgaming.gg</a>.
                </p>
              </div>
            )}
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const [orders, quotes, payouts, attention, documents] = await Promise.all([
    loadSupplierOrders(supplier.id),
    loadSupplierQuotes(supplier.id),
    loadSupplierPayouts(supplier.id),
    getSupplierAttention(supplier.id),
    loadSupplierDocuments(supplier.id),
  ]);

  const readiness = computeSupplierReadiness(supplier, documents);

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
  const openQuotesList = quotes.filter((q) => q.status === "OPEN");
  const openQuotes = openQuotesList.length;
  const oldestQuoteDays =
    openQuotesList.length === 0
      ? null
      : Math.floor(
          (Date.now() -
            openQuotesList
              .map((q) => q.createdAt.getTime())
              .reduce((a, b) => Math.min(a, b))) /
            86400000
        );
  const shipQueueCount = orders.filter((o) => {
    if (o.status !== "PAID") return false;
    const slot = o.supplierSlots[0];
    const stage = slot?.shipmentStage ?? "Pending";
    return stage !== "Shipped" && stage !== "Delivered";
  }).length;
  const payoutsDueCents = payouts
    .filter((p) => p.status === "DUE")
    .reduce((s, p) => s + p.amountCents, 0);

  return (
    <>
      <SiteHeader />
      <SupplierNav active="dashboard" sticky />
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

          <AttentionPanel
            items={attention}
            nextAction={(() => {
              if (supplier.products.length < 10)
                return { label: "Upload more SKUs", href: "/supplier/products" };
              if (openQuotes > 0)
                return { label: "Respond to new RFQs", href: "/supplier/quotes" };
              if (shipQueueCount > 0)
                return {
                  label: "Confirm pending shipments",
                  href: "/supplier/products",
                };
              if (payoutsDueCents > 0)
                return {
                  label: "Review pending payouts",
                  href: "/supplier/payouts",
                };
              return { label: "Browse your catalog", href: "/supplier/products" };
            })()}
          />

          {/* PLH-3l P5: hide the readiness checklist when 10/10 and live.
              Full checklist still renders on /supplier/settings so veterans
              can review every gate. */}
          <GoLiveReadiness
            readiness={readiness}
            publicVisible={supplier.publicVisible}
            hideWhenComplete
          />

          <CompactTiles
            openQuotes={openQuotes}
            oldestQuoteDays={oldestQuoteDays}
            shipQueueCount={shipQueueCount}
            payoutsDueCents={payoutsDueCents}
            showQuotes={showQuotes}
            showOrders={showOrders}
            showPayouts={showPayouts}
            ordersHref="/account#orders"
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

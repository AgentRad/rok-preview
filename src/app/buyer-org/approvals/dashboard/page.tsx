import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { requireUser } from "@/lib/auth";
import { getActiveBuyerOrgContext, canApproveOrders } from "@/lib/buyer-org-access";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * PLH-3y-6 C6: approval SLA dashboard.
 * Shows pending count, avg age, oldest pending, recent resolved.
 */
export default async function ApprovalsDashboardPage() {
  const user = await requireUser();
  if (user.role === "SUPPLIER") redirect("/supplier");
  if (user.role === "MANUFACTURER") redirect("/oem");

  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx) redirect("/account");
  if (!canApproveOrders(ctx.role)) redirect("/buyer-org");

  const now = new Date();

  // Pending count + ages.
  const pending = await prisma.orderApproval.findMany({
    where: {
      outcome: "PENDING",
      order: { buyerOrgId: ctx.org.id },
    },
    select: { createdAt: true, orderId: true },
    orderBy: { createdAt: "asc" },
  });

  const pendingCount = pending.length;
  const avgAgeHours =
    pendingCount > 0
      ? pending.reduce((sum, s) => sum + (now.getTime() - s.createdAt.getTime()) / 3600000, 0) / pendingCount
      : 0;
  const oldestStep = pending[0] ?? null;
  const oldestAgeHours = oldestStep
    ? (now.getTime() - oldestStep.createdAt.getTime()) / 3600000
    : 0;

  // Recent resolved (last 7 days).
  const since7d = new Date(Date.now() - 7 * 24 * 3600000);
  const recentApproved = await prisma.order.count({
    where: { buyerOrgId: ctx.org.id, approvalStatus: "APPROVED", createdAt: { gte: since7d } },
  });
  const recentRejected = await prisma.order.count({
    where: { buyerOrgId: ctx.org.id, approvalStatus: "REJECTED", createdAt: { gte: since7d } },
  });

  // Total pending value.
  const pendingOrders = await prisma.order.findMany({
    where: { buyerOrgId: ctx.org.id, approvalStatus: "PENDING" },
    select: { totalCents: true },
  });
  const pendingValueCents = pendingOrders.reduce((s, o) => s + o.totalCents, 0);

  return (
    <>
      <SiteHeader />
      <main id="main" className="app-page">
        <div className="page-pad narrow">
          <div className="breadcrumb">
            <a href="/buyer-org">{ctx.org.name}</a>
            {" / "}
            <a href="/buyer-org/approvals">Approvals</a>
            {" / "}Dashboard
          </div>
          <h1 className="page-title">Approval SLA dashboard</h1>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
            <div className="card" style={{ padding: "1rem" }}>
              <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Pending approvals</div>
              <div style={{ fontSize: "2rem", fontWeight: 700 }}>{pendingCount}</div>
            </div>
            <div className="card" style={{ padding: "1rem" }}>
              <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Avg age (hours)</div>
              <div style={{ fontSize: "2rem", fontWeight: 700 }}>{avgAgeHours.toFixed(1)}</div>
            </div>
            <div className="card" style={{ padding: "1rem" }}>
              <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Oldest pending (hrs)</div>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: oldestAgeHours > 24 ? "var(--red, #b91c1c)" : "inherit" }}>
                {oldestStep ? oldestAgeHours.toFixed(1) : "—"}
              </div>
            </div>
            <div className="card" style={{ padding: "1rem" }}>
              <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Pending value</div>
              <div style={{ fontSize: "2rem", fontWeight: 700 }}>{formatCents(pendingValueCents)}</div>
            </div>
            <div className="card" style={{ padding: "1rem" }}>
              <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Approved (7d)</div>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--green, #22843a)" }}>{recentApproved}</div>
            </div>
            <div className="card" style={{ padding: "1rem" }}>
              <div className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Rejected (7d)</div>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--red, #b91c1c)" }}>{recentRejected}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "1rem" }}>
            <a href="/buyer-org/approvals" className="btn btn-sm">View pending queue</a>
            <a href="/buyer-org/approval-rules" className="btn btn-sm btn-outline">Manage rules</a>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

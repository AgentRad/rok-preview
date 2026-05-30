import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ApprovalRulesClient from "@/components/ApprovalRulesClient";
import { requireUser } from "@/lib/auth";
import { getActiveBuyerOrgContext, canManageApprovalRules } from "@/lib/buyer-org-access";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ApprovalRulesPage() {
  const user = await requireUser();
  if (user.role === "SUPPLIER") redirect("/supplier");
  if (user.role === "MANUFACTURER") redirect("/oem");

  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx) redirect("/account");
  if (!canManageApprovalRules(ctx.role)) redirect("/buyer-org/approvals");

  const rules = await prisma.approvalRule.findMany({
    where: { buyerOrgId: ctx.org.id },
    orderBy: [{ chainGroup: "asc" }, { chainOrder: "asc" }, { createdAt: "asc" }],
  });

  // Load org members for the approver dropdown.
  const members = await prisma.buyerOrgMember.findMany({
    where: { buyerOrgId: ctx.org.id },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { joinedAt: "asc" },
  });

  return (
    <>
      <SiteHeader />
      <main id="main" className="app-page">
        <div className="page-pad narrow">
          <div className="breadcrumb">
            <a href="/buyer-org">{ctx.org.name}</a>
            {" / "}
            <a href="/buyer-org/approvals">Approvals</a>
            {" / "}Rules
          </div>
          <h1 className="page-title">Approval rules</h1>
          <p className="page-sub">
            Rules define when orders require approval and who approves them.
            An order must match all conditions in a rule to be routed to that approver.
          </p>
          <ApprovalRulesClient
            initialRules={rules.map((r) => ({
              ...r,
              createdAt: r.createdAt.toISOString(),
              minTotalCents: r.minTotalCents,
              maxTotalCents: r.maxTotalCents,
            }))}
            members={members.map((m) => ({
              id: m.id,
              label: m.user.name ? `${m.user.name} (${m.user.email})` : m.user.email,
            }))}
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

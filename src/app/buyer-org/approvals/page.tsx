import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ApprovalsClient from "@/components/ApprovalsClient";
import { requireUser } from "@/lib/auth";
import { getActiveBuyerOrgContext, canApproveOrders } from "@/lib/buyer-org-access";

export const dynamic = "force-dynamic";

/**
 * PLH-3y-6 C3: pending approvals queue for ADMIN and APPROVER members.
 */
export default async function ApprovalsPage() {
  const user = await requireUser();
  if (user.role === "SUPPLIER") redirect("/supplier");
  if (user.role === "MANUFACTURER") redirect("/oem");

  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx) redirect("/account");
  if (!canApproveOrders(ctx.role)) redirect("/buyer-org");

  return (
    <>
      <SiteHeader />
      <main id="main" className="app-page">
        <div className="page-pad narrow">
          <div className="breadcrumb">
            <a href="/buyer-org">{ctx.org.name}</a>
            {" / "}Approvals
          </div>
          <h1 className="page-title">Order approvals</h1>
          <p className="page-sub">
            Review and approve or reject orders placed by your team.
          </p>
          <ApprovalsClient orgName={ctx.org.name} isAdmin={ctx.role === "ADMIN"} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

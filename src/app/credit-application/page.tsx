import { redirect } from "next/navigation";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import CreditApplicationForm from "@/components/CreditApplicationForm";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getActiveBuyerOrgContext,
  canManageBuyerOrg,
} from "@/lib/buyer-org-access";

export const dynamic = "force-dynamic";

const TERMS_LABEL: Record<string, string> = {
  PREPAID: "Prepaid",
  NET_15: "Net 15",
  NET_30: "Net 30",
  NET_60: "Net 60",
};

/**
 * PLH-3z-3: buyer-facing net-terms request. An org ADMIN submits the
 * application; everyone else is pointed back to the org home. If an
 * application already exists, the latest status is shown instead of the form.
 */
export default async function CreditApplicationPage() {
  const user = await requireUser();
  if (user.role === "SUPPLIER") redirect("/supplier");
  if (user.role === "MANUFACTURER") redirect("/oem");

  const ctx = await getActiveBuyerOrgContext(user);

  return (
    <>
      <SiteHeader />
      <main id="main" className="app-page">
        <div className="page-pad narrow">
          <h1 className="page-title">Apply for net terms</h1>
          <p className="page-sub">
            Request invoice billing (Net 15, 30, or 60) for your organization.
            A PartsPort admin reviews each application and sets your approved
            credit limit.
          </p>

          {!ctx ? (
            <div className="alert">
              You are not part of a buyer organization yet. Net terms are
              granted to organizations.{" "}
              <Link href="/account">Go to your account</Link> to get set up, or
              contact your administrator.
            </div>
          ) : !canManageBuyerOrg(ctx.role) ? (
            <div className="alert">
              Only an organization admin can request net terms for{" "}
              {ctx.org.name}. Ask your org admin to submit the application.
            </div>
          ) : (
            await renderForOrg(ctx.org.id, ctx.org.name, ctx.org.paymentTerms)
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

async function renderForOrg(orgId: string, orgName: string, currentTerms: string) {
  const latest = await prisma.creditApplication.findFirst({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });

  if (currentTerms !== "PREPAID") {
    return (
      <div className="alert alert-success">
        {orgName} is approved for {TERMS_LABEL[currentTerms] ?? currentTerms}{" "}
        terms. Orders placed by your members are billed by invoice.
      </div>
    );
  }

  if (latest && latest.status === "PENDING") {
    return (
      <div className="alert">
        Your application <strong>{latest.reference}</strong> is under review.
        Submitted{" "}
        {latest.createdAt.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
        . We will email {latest.apContactEmail} with the decision.
      </div>
    );
  }

  return (
    <>
      {latest && latest.status === "REJECTED" && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          A previous application ({latest.reference}) was not approved.
          {latest.reviewerNote ? ` Note: ${latest.reviewerNote}` : ""} You may
          submit a new application below.
        </div>
      )}
      <CreditApplicationForm orgName={orgName} />
    </>
  );
}

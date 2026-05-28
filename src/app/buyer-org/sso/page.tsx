import { redirect } from "next/navigation";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SsoConfigForm from "@/components/SsoConfigForm";
import { requireUser } from "@/lib/auth";
import {
  getActiveBuyerOrgContext,
  canManageBuyerOrg,
} from "@/lib/buyer-org-access";
import { readSsoConfigView } from "@/lib/sso-config-admin";

export const dynamic = "force-dynamic";

/**
 * PLH-3y-4: org-admin SSO configuration, scoped to the caller's active org.
 * (The spec named /buyer-org/[id]/sso; the org-home surface keys off the
 * active org context like the rest of /buyer-org, so this lives at
 * /buyer-org/sso. A site admin configures any org at
 * /admin/buyer-orgs/[id]/sso.)
 */
export default async function BuyerOrgSsoPage() {
  const user = await requireUser();
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx) redirect("/account");
  if (!canManageBuyerOrg(ctx.role)) redirect("/buyer-org");

  const view = await readSsoConfigView(ctx.org.id);

  return (
    <>
      <SiteHeader />
      <main id="main" className="app-page">
        <div className="page-pad narrow">
          <div className="row between">
            <h1 className="page-title">Single sign-on</h1>
            <Link href="/buyer-org" className="btn btn-ghost btn-sm">
              Back to organization
            </Link>
          </div>
          <p className="page-sub">
            Configure SAML 2.0 single sign-on for {ctx.org.name}. New members
            who sign in through your IdP are provisioned automatically.
          </p>
          <SsoConfigForm endpoint="/api/buyer-org/sso" initial={view} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

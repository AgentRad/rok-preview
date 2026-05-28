import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import SsoConfigForm from "@/components/SsoConfigForm";
import { readSsoConfigView } from "@/lib/sso-config-admin";

export const dynamic = "force-dynamic";

/**
 * PLH-3y-4: site-admin SSO configuration for any buyer org. Mirrors the
 * org-admin surface at /buyer-org/sso but is reachable by a platform admin and
 * scoped to the org in the path.
 */
export default async function AdminBuyerOrgSsoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("ADMIN");
  const { id } = await params;
  const org = await prisma.buyerOrg.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!org) notFound();

  const view = await readSsoConfigView(org.id);

  return (
    <main id="main" className="admin-page">
      <div className="page-pad narrow">
        <div className="admin-page-head">
          <h1 className="page-title">SSO: {org.name}</h1>
          <Link href={`/admin/buyer-orgs/${org.id}`} className="btn btn-ghost btn-sm">
            Back to organization
          </Link>
        </div>
        <p className="page-sub">
          Configure SAML 2.0 single sign-on on behalf of this organization.
        </p>
        <SsoConfigForm endpoint={`/api/admin/buyer-orgs/${org.id}/sso`} initial={view} />
      </div>
    </main>
  );
}

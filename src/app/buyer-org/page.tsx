import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import BuyerOrgClient from "@/components/BuyerOrgClient";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getActiveBuyerOrgContext,
  canManageBuyerOrg,
} from "@/lib/buyer-org-access";

export const dynamic = "force-dynamic";

/**
 * PLH-3y-2: org member home. Shows the active org's shared shipping addresses
 * (ADMIN can add/remove), the org tax-exempt cert, and billing mode. Members
 * who belong to no org are redirected to their account.
 */
export default async function BuyerOrgPage({
  searchParams,
}: {
  searchParams: Promise<{ joined?: string }>;
}) {
  const { joined } = await searchParams;
  const user = await requireUser();
  if (user.role === "SUPPLIER") redirect("/supplier");
  if (user.role === "MANUFACTURER") redirect("/oem");

  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx) redirect("/account");
  const isAdmin = canManageBuyerOrg(ctx.role);

  const addresses = await prisma.buyerOrgAddress.findMany({
    where: { buyerOrgId: ctx.org.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  const domains = await prisma.buyerOrgDomain.findMany({
    where: { buyerOrgId: ctx.org.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <SiteHeader />
      <main id="main" className="app-page">
        <div className="page-pad narrow">
          {joined && (
            <div className="alert alert-success">
              You have joined {joined}. Your role and shared org resources are
              shown below.
            </div>
          )}
          <h1 className="page-title">{ctx.org.name}</h1>
          <p className="page-sub">
            Your role: {ctx.role.toLowerCase()}.{" "}
            {isAdmin
              ? "You manage shared addresses and org settings."
              : "Shared addresses set by your org admin are available at checkout."}
          </p>
          <BuyerOrgClient
            isAdmin={isAdmin}
            taxExempt={{
              status: ctx.org.taxExemptStatus,
              certificateUrl: ctx.org.taxExemptCertificateUrl,
              expiresAt: ctx.org.taxExemptExpiresAt
                ? ctx.org.taxExemptExpiresAt.toISOString()
                : null,
            }}
            billing={{
              mode: ctx.org.billingMode,
              hasStripeCustomer: !!ctx.org.stripeCustomerId,
            }}
            initialDomains={domains.map((d) => ({
              id: d.id,
              domain: d.domain,
              status: d.status,
              verifiedAt: d.verifiedAt ? d.verifiedAt.toISOString() : null,
              txtRecordName: `_partsport.${d.domain}`,
              txtRecordValue: `partsport-verify=${d.verificationToken}`,
              autoJoinEnabled: d.autoJoinEnabled,
              autoJoinRole: d.autoJoinRole,
            }))}
            initialAddresses={addresses.map((a) => ({
              id: a.id,
              label: a.label,
              recipient: a.recipient,
              company: a.company,
              line1: a.line1,
              line2: a.line2,
              city: a.city,
              region: a.region,
              postalCode: a.postalCode,
              country: a.country,
              phone: a.phone,
            }))}
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

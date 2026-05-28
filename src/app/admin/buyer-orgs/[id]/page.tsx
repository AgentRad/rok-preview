import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import BuyerOrgManager from "@/components/admin/BuyerOrgManager";

export const dynamic = "force-dynamic";

export default async function AdminBuyerOrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("ADMIN");
  const { id } = await params;

  const org = await prisma.buyerOrg.findUnique({
    where: { id },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
      },
      invites: {
        where: { acceptedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!org) notFound();

  const members = org.members.map((m) => ({
    id: m.id,
    role: m.role,
    user: m.user,
  }));
  const invites = org.invites.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    expiresAt: i.expiresAt.toISOString(),
  }));

  return (
    <main id="main" className="admin-page">
      <div className="page-pad wide">
        <div className="admin-page-head">
          <h1 className="page-title">{org.name}</h1>
          <div className="row gap">
            <Link href={`/admin/buyer-orgs/${org.id}/sso`} className="btn btn-ghost btn-sm">
              SSO
            </Link>
            <Link href="/admin/buyer-orgs" className="btn btn-ghost btn-sm">
              All organizations
            </Link>
          </div>
        </div>
        <p className="page-sub">
          Add existing buyers directly, or invite a new email. ADMIN manages
          members and sees all org orders. APPROVER is reserved for a later
          round and behaves like BUYER for now. VIEWER is read-only.
        </p>

        <BuyerOrgManager orgId={org.id} initialMembers={members} initialInvites={invites} />
      </div>
    </main>
  );
}

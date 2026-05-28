import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import BuyerOrgCreateForm from "@/components/admin/BuyerOrgCreateForm";

export const dynamic = "force-dynamic";

/**
 * PLH-3y-1: admin-managed buyer organizations. Create an org, then open it to
 * add members and send invites. No self-serve creation this round.
 */
export default async function AdminBuyerOrgsPage() {
  await requireRole("ADMIN");

  const orgs = await prisma.buyerOrg.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { members: true, invites: true } },
    },
  });

  return (
    <main id="main" className="admin-page">
      <div className="page-pad wide">
        <div className="admin-page-head">
          <h1 className="page-title">Buyer organizations</h1>
          <Link href="/admin" className="btn btn-ghost btn-sm">
            Back to admin
          </Link>
        </div>
        <p className="page-sub">
          Group buyers under a company so they share an org context. Members
          and invites are managed per org. Buyers cannot create orgs
          themselves.
        </p>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-body">
            <BuyerOrgCreateForm />
          </div>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-body">
            {orgs.length === 0 ? (
              <p className="muted">No buyer organizations yet.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Members</th>
                    <th>Pending invites</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id}>
                      <td>{o.name}</td>
                      <td>{o._count.members}</td>
                      <td>{o._count.invites}</td>
                      <td>
                        <Link
                          className="btn btn-ghost btn-sm"
                          href={`/admin/buyer-orgs/${o.id}`}
                        >
                          Manage
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

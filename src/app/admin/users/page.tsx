import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import AdminUserRow from "@/components/AdminUserRow";

export const dynamic = "force-dynamic";

/**
 * PLH-3w P1: admin user directory with trust controls. Filter by status,
 * suspend/unsuspend per row, or ban (terminal). Suspend and ban require a
 * reason and are audit-logged via src/lib/user-status.ts.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const statusFilter = (sp.status || "ALL").toUpperCase();
  const q = (sp.q || "").trim();

  const where: Prisma.UserWhereInput = { deletedAt: null };
  if (
    statusFilter === "ACTIVE" ||
    statusFilter === "SUSPENDED" ||
    statusFilter === "BANNED"
  ) {
    where.status = statusFilter;
  }
  if (q) {
    where.OR = [
      { email: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ];
  }

  const users = await prisma.user.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      suspendedAt: true,
      suspendedReason: true,
      createdAt: true,
    },
  });

  const tabs: { key: string; label: string }[] = [
    { key: "ALL", label: "All" },
    { key: "ACTIVE", label: "Active" },
    { key: "SUSPENDED", label: "Suspended" },
    { key: "BANNED", label: "Banned" },
  ];

  const qs = (status: string) => {
    const params = new URLSearchParams();
    if (status !== "ALL") params.set("status", status);
    if (q) params.set("q", q);
    const s = params.toString();
    return s ? `/admin/users?${s}` : "/admin/users";
  };

  return (
    <main id="main" className="admin-page">
      <div className="page-pad wide">
        <div className="admin-page-head">
          <h1 className="page-title">Users</h1>
          <Link href="/admin" className="btn btn-ghost btn-sm">
            Back to admin
          </Link>
        </div>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-body">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {tabs.map((t) => (
                <Link
                  key={t.key}
                  href={qs(t.key)}
                  className={
                    statusFilter === t.key
                      ? "btn btn-sm btn-primary"
                      : "btn btn-sm btn-ghost"
                  }
                >
                  {t.label}
                </Link>
              ))}
            </div>
            <form method="get" action="/admin/users" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {statusFilter !== "ALL" && (
                <input type="hidden" name="status" value={statusFilter} />
              )}
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="Search name or email"
                style={{ flex: 1, minWidth: 220 }}
              />
              <button className="btn btn-sm btn-ghost" type="submit">
                Search
              </button>
            </form>

            {users.length === 0 ? (
              <p className="muted">No users match this filter.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <AdminUserRow
                      key={u.id}
                      id={u.id}
                      name={u.name}
                      email={u.email}
                      role={u.role}
                      status={u.status}
                      suspendedReason={u.suspendedReason}
                      createdAt={u.createdAt.toISOString()}
                    />
                  ))}
                </tbody>
              </table>
            )}
            {users.length === 200 && (
              <p className="muted" style={{ marginTop: 8 }}>
                Showing the 200 most recent. Narrow with search or a status filter.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

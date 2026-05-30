import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Per-US-state remittance tracker. Stripe Tax computes liability; this
 * page records what PartsPort has actually registered to file. The
 * states with rows are the ones that need active filing; the rest of
 * the country sits in NOT_REQUIRED until volume crosses the threshold.
 *
 * The page is read-mostly. Admin can edit rows from the supplier admin
 * console once the state is large enough to need active management.
 */

const STATUS_BADGE: Record<string, string> = {
  NOT_REQUIRED: "badge-pending",
  REQUIRED: "badge-cancelled",
  REGISTERED: "badge-fulfilled",
  FILING: "badge-pending",
};

const STATUS_LABEL: Record<string, string> = {
  NOT_REQUIRED: "Not required",
  REQUIRED: "Required (not yet registered)",
  REGISTERED: "Registered",
  FILING: "Filing in progress",
};

export default async function TaxRegistrationsPage() {
  await requireRole("ADMIN");
  const rows = await prisma.taxRegistration.findMany({
    orderBy: [
      { registrationStatus: "asc" },
      { state: "asc" },
    ],
  });
  return (
    <>
      <main id="main" className="app-page">
        <div className="page-pad">
          <h1 className="page-title">Tax registrations</h1>
          <p className="page-sub">
            Per-state PartsPort remittance status. Stripe Tax computes
            liability per order automatically; this table records where
            PartsPort has filed to remit. Cross-reference with Stripe
            Dashboard &rarr; Tax for the YTD per-state taxable sales
            totals.{" "}
            <Link
              href="/admin"
              style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
            >
              ← Back to admin
            </Link>
          </p>

          <div className="card" style={{ marginTop: 18 }}>
            <div className="card-head">
              <h2>
                {rows.length} state{rows.length === 1 ? "" : "s"} tracked
              </h2>
              <a
                className="btn btn-ghost btn-sm"
                href={`/api/admin/tax-report.csv?period=${new Date().toISOString().slice(0, 7)}`}
                download
              >
                Export tax report (CSV)
              </a>
            </div>
            {rows.length === 0 ? (
              <div className="empty-block">
                <h3>No states tracked yet</h3>
                <p>
                  Add rows from the Stripe Tax dashboard or via direct DB
                  edit when a state crosses nexus. The day this page lists
                  more than 10 states is the day PartsPort hires an
                  accountant.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>State</th>
                      <th>Status</th>
                      <th>Registered</th>
                      <th>Next filing due</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 700 }}>{r.state}</td>
                        <td>
                          <span
                            className={
                              "badge " +
                              (STATUS_BADGE[r.registrationStatus] || "badge-pending")
                            }
                          >
                            {STATUS_LABEL[r.registrationStatus] ||
                              r.registrationStatus}
                          </span>
                        </td>
                        <td style={{ fontSize: 12.5 }}>
                          {r.registeredAt
                            ? r.registeredAt.toLocaleDateString()
                            : "not set"}
                        </td>
                        <td style={{ fontSize: 12.5 }}>
                          {r.nextFilingDue
                            ? r.nextFilingDue.toLocaleDateString()
                            : "not set"}
                        </td>
                        <td style={{ fontSize: 12.5 }}>{r.notes || "."}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

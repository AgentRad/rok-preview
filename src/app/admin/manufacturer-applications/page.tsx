import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import Link from "next/link";
import ManufacturerApplicationRow from "@/components/ManufacturerApplicationRow";

export const dynamic = "force-dynamic";

/**
 * PLH-3c F3: admin review queue for OEM brand claims. Anyone signing up
 * as MANUFACTURER and picking a brand name lands here as a PENDING row.
 * Approve writes User.manufacturerName + flips status APPROVED + emails
 * the OEM. Reject stores a reason + emails the OEM.
 */
export default async function ManufacturerApplicationsPage() {
  await requireRole("ADMIN");

  const apps = await prisma.manufacturerApplication.findMany({
    orderBy: [{ status: "asc" }, { submittedAt: "desc" }],
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });

  const pending = apps.filter((a) => a.status === "PENDING");
  const reviewed = apps.filter((a) => a.status !== "PENDING");

  return (
    <main id="main" className="admin-page">
      <div className="page-pad wide">
        <div className="admin-page-head">
          <h1 className="page-title">Manufacturer applications</h1>
          <Link href="/admin" className="btn btn-ghost btn-sm">
            Back to admin
          </Link>
        </div>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2>Approval criteria</h2>
          </div>
          <div className="card-body">
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.6 }}>
              <li>Verify the legal entity exists (state registration, EIN, or equivalent).</li>
              <li>Real website at a brand-owned domain. No social-only presence.</li>
              <li>Brand name is not already claimed by another approved manufacturer.</li>
              <li>Watch for red flags: free-mail domains, generic names matching well-known brands, blank or copy-pasted descriptions.</li>
              <li>Decline duplicates with a clear reason so the applicant can re-submit if it was a typo.</li>
            </ul>
          </div>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2>Pending review ({pending.length})</h2>
          </div>
          <div className="card-body">
            {pending.length === 0 ? (
              <p className="muted">No applications waiting on review.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Brand</th>
                    <th>Account</th>
                    <th>Submitted</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((a) => (
                    <ManufacturerApplicationRow
                      key={a.id}
                      id={a.id}
                      manufacturerName={a.manufacturerName}
                      userName={a.user.name}
                      userEmail={a.user.email}
                      submittedAt={a.submittedAt.toISOString()}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2>Reviewed ({reviewed.length})</h2>
          </div>
          <div className="card-body">
            {reviewed.length === 0 ? (
              <p className="muted">Nothing reviewed yet.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Brand</th>
                    <th>Account</th>
                    <th>Status</th>
                    <th>Reviewed</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewed.map((a) => (
                    <tr key={a.id}>
                      <td>{a.manufacturerName}</td>
                      <td>
                        {a.user.name} <span className="muted">({a.user.email})</span>
                      </td>
                      <td>
                        <span
                          className={
                            a.status === "APPROVED"
                              ? "badge badge-paid"
                              : "badge badge-cancelled"
                          }
                        >
                          {a.status}
                        </span>
                      </td>
                      <td>
                        {a.reviewedAt
                          ? new Date(a.reviewedAt).toLocaleString()
                          : ""}
                      </td>
                      <td>{a.rejectionReason || ""}</td>
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

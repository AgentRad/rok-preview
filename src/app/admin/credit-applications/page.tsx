import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import Link from "next/link";
import CreditApplicationReview from "@/components/admin/CreditApplicationReview";

export const dynamic = "force-dynamic";

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * PLH-3z-3: admin review queue for net-terms credit applications. PENDING
 * first. Approve sets the org's paymentTerms + creditLimitCents from the
 * approved values; reject stores a reason. Both email the AP contact.
 */
export default async function CreditApplicationsPage() {
  await requireRole("ADMIN");

  const apps = await prisma.creditApplication.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { org: { select: { name: true } } },
  });

  const pending = apps.filter((a) => a.status === "PENDING");
  const reviewed = apps.filter((a) => a.status !== "PENDING");

  return (
    <main id="main" className="admin-page">
      <div className="page-pad wide">
        <div className="admin-page-head">
          <h1 className="page-title">Credit applications</h1>
          <div className="row gap">
            <Link href="/admin/accounts-receivable" className="btn btn-ghost btn-sm">
              Accounts receivable
            </Link>
            <Link href="/admin" className="btn btn-ghost btn-sm">
              Back to admin
            </Link>
          </div>
        </div>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2>Pending review ({pending.length})</h2>
          </div>
          <div className="card-body">
            {pending.length === 0 ? (
              <p className="muted">No applications waiting on review.</p>
            ) : (
              <div style={{ display: "grid", gap: "1rem" }}>
                {pending.map((a) => (
                  <CreditApplicationReview
                    key={a.id}
                    app={{
                      id: a.id,
                      reference: a.reference,
                      orgName: a.org?.name ?? null,
                      legalName: a.legalName,
                      dba: a.dba,
                      ein: a.ein,
                      yearsInBusiness: a.yearsInBusiness,
                      expectedMonthlyCents: a.expectedMonthlyCents,
                      requestedLimitCents: a.requestedLimitCents,
                      requestedTerms: a.requestedTerms,
                      billingAddress: a.billingAddress,
                      apContactName: a.apContactName,
                      apContactEmail: a.apContactEmail,
                      apContactPhone: a.apContactPhone,
                      references: Array.isArray(a.references) ? (a.references as unknown[]) : [],
                      w9BlobUrl: a.w9BlobUrl,
                      dunsNumber: a.dunsNumber,
                      notes: a.notes,
                      createdAt: a.createdAt.toISOString(),
                    }}
                  />
                ))}
              </div>
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
                    <th>Reference</th>
                    <th>Organization</th>
                    <th>Status</th>
                    <th>Terms</th>
                    <th>Approved limit</th>
                    <th>Reviewed</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewed.map((a) => (
                    <tr key={a.id}>
                      <td>{a.reference}</td>
                      <td>{a.org?.name ?? a.legalName}</td>
                      <td>{a.status}</td>
                      <td>{a.approvedTerms ?? "-"}</td>
                      <td>{a.approvedLimitCents != null ? `$${dollars(a.approvedLimitCents)}` : "-"}</td>
                      <td>
                        {a.reviewedAt
                          ? a.reviewedAt.toISOString().slice(0, 10)
                          : "-"}
                      </td>
                      <td className="muted">{a.reviewerNote || "-"}</td>
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

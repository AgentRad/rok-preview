import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import Link from "next/link";
import ReportedMessageRow from "@/components/ReportedMessageRow";

export const dynamic = "force-dynamic";

/**
 * PLH-3w P3: admin review queue for abuse reports. Lists messages with a
 * pending report (reportedAt set, not yet reviewed) with the message body,
 * thread context, reporter, and reason. Each row can be dismissed or the
 * sender suspended via the P1 /admin/users flow.
 */
export default async function ReportedMessagesPage() {
  await requireRole("ADMIN");

  const reported = await prisma.message.findMany({
    where: { reportedAt: { not: null }, reviewedAt: null },
    orderBy: { reportedAt: "asc" },
    take: 200,
    select: {
      id: true,
      body: true,
      senderName: true,
      senderEmail: true,
      senderRole: true,
      senderId: true,
      reportedAt: true,
      reportReason: true,
      reportedByUserId: true,
      orderId: true,
      quoteId: true,
      directThreadId: true,
    },
  });

  const reporterIds = Array.from(
    new Set(reported.map((m) => m.reportedByUserId).filter(Boolean) as string[])
  );
  const reporters = reporterIds.length
    ? await prisma.user.findMany({
        where: { id: { in: reporterIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const reporterById = new Map(reporters.map((r) => [r.id, r]));

  function threadContext(m: (typeof reported)[number]): {
    label: string;
    href: string | null;
  } {
    if (m.orderId) return { label: "Order thread", href: `/orders/${m.orderId}` };
    if (m.quoteId) return { label: "Quote thread", href: `/quotes/${m.quoteId}` };
    if (m.directThreadId)
      return { label: "Direct message", href: `/messages/${m.directThreadId}` };
    return { label: "Unknown", href: null };
  }

  return (
    <main id="main" className="admin-page">
      <div className="page-pad wide">
        <div className="admin-page-head">
          <h1 className="page-title">Reported messages</h1>
          <Link href="/admin" className="btn btn-ghost btn-sm">
            Back to admin
          </Link>
        </div>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2>Pending review ({reported.length})</h2>
          </div>
          <div className="card-body">
            {reported.length === 0 ? (
              <p className="muted">No reports waiting on review.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Message</th>
                    <th>Sender</th>
                    <th>Reported by</th>
                    <th>Reason</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reported.map((m) => {
                    const ctx = threadContext(m);
                    const reporter = m.reportedByUserId
                      ? reporterById.get(m.reportedByUserId)
                      : null;
                    return (
                      <ReportedMessageRow
                        key={m.id}
                        id={m.id}
                        body={m.body}
                        senderName={m.senderName}
                        senderEmail={m.senderEmail}
                        senderRole={m.senderRole}
                        reporterLabel={
                          reporter
                            ? `${reporter.name} (${reporter.email})`
                            : "Unknown"
                        }
                        reason={m.reportReason || ""}
                        reportedAt={m.reportedAt ? m.reportedAt.toISOString() : ""}
                        contextLabel={ctx.label}
                        contextHref={ctx.href}
                      />
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

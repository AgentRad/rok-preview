import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { daysPastDue } from "@/lib/accounts-receivable";

export const dynamic = "force-dynamic";

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function ymd(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "-";
}

const UNPAID = ["DUE", "PAST_DUE"] as const;

/**
 * PLH-3z-3: per-org A/R drilldown. Header card (limit, available, outstanding,
 * terms, status), outstanding invoices, paid invoices (last 12 months with
 * days-to-pay), members, and org activity.
 */
export default async function ArOrgDrilldownPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  await requireRole("ADMIN");
  const { orgId } = await params;
  const now = new Date();

  const org = await prisma.buyerOrg.findUnique({
    where: { id: orgId },
    include: {
      members: {
        include: { user: { select: { name: true, email: true } } },
        orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
      },
    },
  });
  if (!org) notFound();

  const outstanding = await prisma.invoice.findMany({
    where: { status: { in: [...UNPAID] }, order: { buyerOrgId: orgId } },
    select: {
      number: true,
      status: true,
      issuedAt: true,
      dueDate: true,
      totalCents: true,
      partialPaidCents: true,
      order: { select: { reference: true, invoiceDueDate: true } },
    },
    orderBy: { issuedAt: "asc" },
  });

  const since = new Date(now.getTime() - 365 * 86400000);
  const paid = await prisma.invoice.findMany({
    where: { status: "PAID", paidAt: { gte: since }, order: { buyerOrgId: orgId } },
    select: {
      number: true,
      issuedAt: true,
      paidAt: true,
      totalCents: true,
      order: { select: { reference: true } },
    },
    orderBy: { paidAt: "desc" },
  });

  const activity = await prisma.auditLog.findMany({
    where: { targetType: "BuyerOrg", targetId: orgId },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  const outstandingCents = outstanding.reduce(
    (n, i) => n + Math.max(0, i.totalCents - i.partialPaidCents),
    0
  );
  const availableCents =
    org.creditLimitCents != null ? org.creditLimitCents - outstandingCents : null;

  return (
    <main id="main" className="admin-page">
      <div className="page-pad wide">
        <div className="admin-page-head">
          <h1 className="page-title">{org.name}</h1>
          <Link href="/admin/accounts-receivable" className="btn btn-ghost btn-sm">
            Back to A/R
          </Link>
        </div>

        <section className="metric-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginTop: 16 }}>
          <Metric label="Terms" value={org.paymentTerms} />
          <Metric label="Credit limit" value={org.creditLimitCents != null ? usd(org.creditLimitCents) : "-"} />
          <Metric label="Outstanding" value={usd(outstandingCents)} />
          <Metric label="Available" value={availableCents != null ? usd(availableCents) : "-"} />
          <Metric label="Status" value="ACTIVE" />
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head"><h2>Outstanding invoices ({outstanding.length})</h2></div>
          <div className="card-body">
            {outstanding.length === 0 ? (
              <p className="muted">No outstanding invoices.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Order</th>
                    <th>Issued</th>
                    <th>Due</th>
                    <th>Age</th>
                    <th>Total</th>
                    <th>Partial paid</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {outstanding.map((i) => {
                    const due = i.dueDate ?? i.order.invoiceDueDate ?? null;
                    const past = daysPastDue(due, now);
                    return (
                      <tr key={i.number}>
                        <td>{i.number}</td>
                        <td>{i.order.reference}</td>
                        <td>{ymd(i.issuedAt)}</td>
                        <td>{ymd(due)}</td>
                        <td>{past > 0 ? `${past}d past` : "current"}</td>
                        <td>{usd(i.totalCents)}</td>
                        <td>{i.partialPaidCents > 0 ? usd(i.partialPaidCents) : "-"}</td>
                        <td>{i.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head"><h2>Paid invoices, last 12 months ({paid.length})</h2></div>
          <div className="card-body">
            {paid.length === 0 ? (
              <p className="muted">No invoices paid in the last 12 months.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Order</th>
                    <th>Issued</th>
                    <th>Paid</th>
                    <th>Days to pay</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {paid.map((i) => {
                    const dtp = i.paidAt
                      ? Math.round((i.paidAt.getTime() - i.issuedAt.getTime()) / 86400000)
                      : null;
                    return (
                      <tr key={i.number}>
                        <td>{i.number}</td>
                        <td>{i.order.reference}</td>
                        <td>{ymd(i.issuedAt)}</td>
                        <td>{ymd(i.paidAt)}</td>
                        <td>{dtp != null ? `${dtp}d` : "-"}</td>
                        <td>{usd(i.totalCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head"><h2>Members ({org.members.length})</h2></div>
          <div className="card-body">
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th></tr>
              </thead>
              <tbody>
                {org.members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.user.name}</td>
                    <td>{m.user.email}</td>
                    <td>{m.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head"><h2>Activity</h2></div>
          <div className="card-body">
            {activity.length === 0 ? (
              <p className="muted">No org activity logged.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr><th>Date</th><th>Action</th><th>Summary</th></tr>
                </thead>
                <tbody>
                  {activity.map((a) => (
                    <tr key={a.id}>
                      <td>{a.createdAt.toISOString().slice(0, 10)}</td>
                      <td>{a.action}</td>
                      <td className="muted">{a.summary}</td>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: "1rem" }}>
      <div className="muted" style={{ fontSize: 12.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { loadArDashboard, type AgingBuckets } from "@/lib/accounts-receivable";

export const dynamic = "force-dynamic";

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

const BUCKET_LABELS: { key: keyof AgingBuckets; label: string; color: string }[] = [
  { key: "current", label: "Current", color: "#4a7c59" },
  { key: "d1_30", label: "1-30 days", color: "#c9a227" },
  { key: "d31_60", label: "31-60 days", color: "#d98324" },
  { key: "d61_90", label: "61-90 days", color: "#c45d3a" },
  { key: "d90plus", label: "90+ days", color: "#a02c2c" },
];

/**
 * PLH-3z-3: accounts-receivable dashboard. Outstanding balance by org, aging
 * buckets, top-level metrics, per-supplier working-capital exposure, and CSV
 * exports. Aging is computed from invoiceDueDate on unpaid DUE/PAST_DUE
 * invoices.
 */
export default async function AccountsReceivablePage() {
  await requireRole("ADMIN");
  const data = await loadArDashboard();

  const agingTotal = BUCKET_LABELS.reduce((n, b) => n + data.aging[b.key], 0);

  return (
    <main id="main" className="admin-page">
      <div className="page-pad wide">
        <div className="admin-page-head">
          <h1 className="page-title">Accounts receivable</h1>
          <div className="row gap">
            <a href="/api/admin/ar/outstanding.csv" className="btn btn-ghost btn-sm">
              Outstanding CSV
            </a>
            <a href="/api/admin/ar/payments.csv" className="btn btn-ghost btn-sm">
              Payments CSV
            </a>
            <Link href="/admin/credit-applications" className="btn btn-ghost btn-sm">
              Credit applications
            </Link>
            <Link href="/admin" className="btn btn-ghost btn-sm">
              Back to admin
            </Link>
          </div>
        </div>

        <section className="metric-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginTop: 16 }}>
          <Metric label="Total outstanding" value={usd(data.totalOutstandingCents)} />
          <Metric label="Total overdue" value={usd(data.totalOverdueCents)} />
          <Metric label="Orgs with A/R" value={String(data.orgsWithArCount)} />
          <Metric
            label="Avg days to pay (90d)"
            value={data.avgDaysToPay != null ? data.avgDaysToPay.toFixed(1) : "-"}
          />
          <Metric label="Fronted to suppliers" value={usd(data.totalFrontedCents)} />
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2>Aging</h2>
          </div>
          <div className="card-body">
            {agingTotal === 0 ? (
              <p className="muted">No outstanding invoices.</p>
            ) : (
              <>
                <div style={{ display: "flex", height: 28, borderRadius: 4, overflow: "hidden", border: "1px solid var(--hairline, #ddd)" }}>
                  {BUCKET_LABELS.map((b) =>
                    data.aging[b.key] > 0 ? (
                      <div
                        key={b.key}
                        title={`${b.label}: ${usd(data.aging[b.key])}`}
                        style={{
                          width: `${(data.aging[b.key] / agingTotal) * 100}%`,
                          background: b.color,
                        }}
                      />
                    ) : null
                  )}
                </div>
                <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", marginTop: "0.75rem", fontSize: 13 }}>
                  {BUCKET_LABELS.map((b) => (
                    <span key={b.key}>
                      <span style={{ display: "inline-block", width: 10, height: 10, background: b.color, borderRadius: 2, marginRight: 5 }} />
                      {b.label}: <strong>{usd(data.aging[b.key])}</strong>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2>By organization</h2>
          </div>
          <div className="card-body">
            {data.orgs.length === 0 ? (
              <p className="muted">No organizations have outstanding A/R.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Terms</th>
                    <th>Credit limit</th>
                    <th>Outstanding</th>
                    <th>Overdue</th>
                    <th>Available</th>
                    <th>Oldest</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.orgs.map((o) => (
                    <tr key={o.orgId ?? "unassigned"}>
                      <td>{o.orgName}</td>
                      <td>{o.terms ?? "-"}</td>
                      <td>{o.creditLimitCents != null ? usd(o.creditLimitCents) : "-"}</td>
                      <td>{usd(o.outstandingCents)}</td>
                      <td>{usd(o.overdueCents)}</td>
                      <td>{o.availableCents != null ? usd(o.availableCents) : "-"}</td>
                      <td>{o.oldestAgeDays > 0 ? `${o.oldestAgeDays}d` : "current"}</td>
                      <td>{o.status}</td>
                      <td>
                        {o.orgId ? (
                          <Link href={`/admin/accounts-receivable/${o.orgId}`} className="btn btn-ghost btn-sm">
                            View
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2>Supplier exposure</h2>
          </div>
          <div className="card-body">
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Order value tied up in unpaid buyer invoices, by supplier. Working
              capital out on each supplier&apos;s behalf.
            </p>
            {data.supplierExposure.length === 0 ? (
              <p className="muted">No exposure.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Exposure</th>
                  </tr>
                </thead>
                <tbody>
                  {data.supplierExposure.map((s) => (
                    <tr key={s.supplierName}>
                      <td>{s.supplierName}</td>
                      <td>{usd(s.exposureCents)}</td>
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
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

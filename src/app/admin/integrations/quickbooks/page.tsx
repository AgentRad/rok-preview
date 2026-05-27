import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import {
  QBO_PROVIDER,
  intuitConfigured,
  intuitEnvironment,
} from "@/lib/qbo-auth";
import ReconcileButton from "./ReconcileButton";

export const dynamic = "force-dynamic";

/**
 * PLH-3i P5: full admin dashboard for QuickBooks Online. Shows
 * connection status, sync stats (synced, pending, failures), the
 * last 10 QBO_* audit rows, and a "Run reconcile now" button that
 * calls the same helper as the daily cron.
 */
export default async function AdminQuickBooksPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string }>;
}) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const justConnected = sp?.connected === "1";

  const configured = intuitConfigured();
  const env = intuitEnvironment();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    credential,
    invoicesSynced,
    refundsSynced,
    pendingInvoices,
    pendingRefunds,
    failures7d,
    recentActivity,
  ] = await Promise.all([
    configured
      ? prisma.integrationCredential.findFirst({
          where: { provider: QBO_PROVIDER },
          orderBy: { connectedAt: "desc" },
        })
      : Promise.resolve(null),
    prisma.invoice.count({ where: { qboInvoiceId: { not: null } } }),
    prisma.refund.count({ where: { qboRefundReceiptId: { not: null } } }),
    prisma.invoice.count({
      where: {
        qboInvoiceId: null,
        order: { status: "PAID" },
      },
    }),
    prisma.refund.count({
      where: {
        qboRefundReceiptId: null,
        order: { invoice: { qboInvoiceId: { not: null } } },
      },
    }),
    prisma.auditLog.count({
      where: {
        action: "QBO_SYNC_FAILED",
        createdAt: { gt: sevenDaysAgo },
      },
    }),
    prisma.auditLog.findMany({
      where: { action: { startsWith: "QBO_" } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return (
    <main id="main" className="admin-page">
      <div className="page-pad wide">
        <div className="admin-page-head">
          <h1 className="page-title">QuickBooks Online integration</h1>
          <Link href="/admin" className="btn btn-ghost btn-sm">
            Back to admin
          </Link>
        </div>

        {justConnected ? (
          <div
            className="card"
            style={{
              marginTop: 16,
              borderColor: "#1f7a3a",
              background: "#eaf6ee",
            }}
          >
            <div className="card-body">
              <strong>Connected to QuickBooks.</strong>
            </div>
          </div>
        ) : null}

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2>Status</h2>
          </div>
          <div className="card-body">
            {!configured ? (
              <p>
                Intuit OAuth env vars are not set. Add{" "}
                <code>INTUIT_CLIENT_ID</code> and{" "}
                <code>INTUIT_CLIENT_SECRET</code> to Vercel, then redeploy.
                Set <code>INTUIT_ENVIRONMENT</code> to{" "}
                <code>sandbox</code> or <code>production</code> (defaults to{" "}
                <code>sandbox</code>).
              </p>
            ) : credential ? (
              <>
                <p>
                  Connected to realm <strong>{credential.realmId}</strong>,
                  since{" "}
                  {new Date(credential.connectedAt).toLocaleString()}.
                </p>
                <p className="muted">
                  Environment: <strong>{env}</strong>. Token expires{" "}
                  {new Date(credential.expiresAt).toLocaleString()}.
                  {credential.lastUsedAt ? (
                    <>
                      {" "}
                      Last used{" "}
                      {new Date(credential.lastUsedAt).toLocaleString()}.
                    </>
                  ) : null}
                </p>
                <form
                  method="POST"
                  action="/api/admin/integrations/quickbooks/disconnect"
                  style={{ marginTop: 12 }}
                >
                  <button type="submit" className="btn btn-secondary btn-sm">
                    Disconnect
                  </button>
                </form>
              </>
            ) : (
              <>
                <p>
                  Not connected. Environment: <strong>{env}</strong>.
                </p>
                <p style={{ marginTop: 12 }}>
                  <a
                    href="/api/admin/integrations/quickbooks/connect"
                    className="btn btn-primary btn-sm"
                  >
                    Connect to QuickBooks
                  </a>
                </p>
              </>
            )}
          </div>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2>Sync stats</h2>
          </div>
          <div className="card-body">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              <StatTile label="Invoices synced" value={invoicesSynced} />
              <StatTile label="Refunds synced" value={refundsSynced} />
              <StatTile
                label="Pending invoice syncs"
                value={pendingInvoices}
                tone={pendingInvoices > 0 ? "warn" : undefined}
              />
              <StatTile
                label="Pending refund syncs"
                value={pendingRefunds}
                tone={pendingRefunds > 0 ? "warn" : undefined}
              />
              <StatTile
                label="Sync failures (7d)"
                value={failures7d}
                tone={failures7d > 0 ? "alert" : undefined}
              />
            </div>
            <div style={{ marginTop: 16 }}>
              <ReconcileButton disabled={!configured || !credential} />
              {!credential ? (
                <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                  Connect QuickBooks first to enable manual reconcile.
                </p>
              ) : (
                <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                  Reconcile retries any pending invoice or refund syncs
                  from the last 30 days. Capped at 200 invoices and 200
                  refunds per run.
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2>Recent activity</h2>
          </div>
          <div className="card-body">
            {recentActivity.length === 0 ? (
              <p className="muted">No QuickBooks activity logged yet.</p>
            ) : (
              <table
                className="data-table"
                style={{ width: "100%", fontSize: 14 }}
              >
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>When</th>
                    <th style={{ textAlign: "left" }}>Action</th>
                    <th style={{ textAlign: "left" }}>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {recentActivity.map((row) => (
                    <tr key={row.id}>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td>
                        <code style={{ fontSize: 12 }}>{row.action}</code>
                      </td>
                      <td>{row.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2>About this integration</h2>
          </div>
          <div className="card-body">
            <p>
              Connecting QuickBooks syncs paid invoices and refunds into
              your QBO company file automatically. The daily reconcile
              cron retries any rows that failed to sync at the moment of
              payment or refund. Use Run reconcile now to flush pending
              rows on demand.
            </p>
            <p className="muted" style={{ marginTop: 8 }}>
              Tokens are stored at rest in the database in plain text at
              this round. A future round encrypts them once the platform
              has a shared encryption key in place.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn" | "alert";
}) {
  const borderColor =
    tone === "alert" ? "#c0392b" : tone === "warn" ? "#b7791f" : undefined;
  const background =
    tone === "alert" ? "#fdecea" : tone === "warn" ? "#fdf6e3" : undefined;
  return (
    <div
      className="card"
      style={{
        margin: 0,
        borderColor,
        background,
      }}
    >
      <div className="card-body" style={{ padding: 12 }}>
        <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {label}
        </div>
        <div style={{ fontSize: 28, fontWeight: 600, marginTop: 4 }}>
          {value.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

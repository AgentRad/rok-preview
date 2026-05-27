import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import {
  QBO_PROVIDER,
  intuitConfigured,
  intuitEnvironment,
} from "@/lib/qbo-auth";

export const dynamic = "force-dynamic";

/**
 * PLH-3i P1: admin connect page for QuickBooks Online. Minimal at this
 * round; the full dashboard widget (sync stats, error counts, last sync
 * time) lands in P5 once the sync paths are wired.
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
  const credential = configured
    ? await prisma.integrationCredential.findFirst({
        where: { provider: QBO_PROVIDER },
        orderBy: { connectedAt: "desc" },
      })
    : null;

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
            <h2>About this integration</h2>
          </div>
          <div className="card-body">
            <p>
              Connecting QuickBooks lets PartsPort sync paid invoices and
              refunds into your QBO company file automatically. The sync
              jobs land in subsequent phases of PLH-3i. For now, this page
              only manages the OAuth credential.
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

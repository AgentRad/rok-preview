import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ReorderButton from "@/components/ReorderButton";
import AddressBook from "@/components/AddressBook";
import AttentionFeed from "@/components/AttentionFeed";
import { getBuyerAttention } from "@/lib/attention";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  PENDING: "badge-pending",
  PAID: "badge-paid",
  FULFILLED: "badge-fulfilled",
  CANCELLED: "badge-cancelled",
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string; recover?: string }>;
}) {
  const user = await requireUser();
  // /account is the buyer's home. Suppliers and OEMs land on their own
  // dashboards instead - admin stays here so they can use it as a buyer
  // surrogate during testing.
  if (user.role === "SUPPLIER") redirect("/supplier");
  if (user.role === "MANUFACTURER") redirect("/oem");
  const sp = await searchParams;
  const verifiedFlag = sp.verified;
  const recoverFlag = sp.recover;
  const [orders, attention, addresses] = await Promise.all([
    prisma.order.findMany({
      where: { buyerId: user.id },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    }),
    getBuyerAttention(user.id),
    user.role === "BUYER"
      ? prisma.address.findMany({
          where: { userId: user.id },
          orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <SiteHeader />
      <main id="main" className="app-page">
        <div className="page-pad narrow">
          {recoverFlag === "1" && (
            <div className="alert alert-ok" style={{ marginBottom: 16 }}>
              <strong>Account recovered.</strong> Welcome back. Deletion is
              cancelled and your account is active again.
            </div>
          )}
          {verifiedFlag === "1" && (
            <div className="alert alert-ok" style={{ marginBottom: 16 }}>
              <strong>Email verified.</strong> You can now place orders and
              respond to RFQs.
            </div>
          )}
          {verifiedFlag === "expired" && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              <strong>Verification link is no longer valid.</strong> It may
              have expired or been used already. Use the Resend button in the
              banner above to get a new one.
            </div>
          )}
          <h1 className="page-title">My orders</h1>
          <p className="page-sub">
            Signed in as {user.name} · {user.email} ·{" "}
            <Link
              href="/settings"
              style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
            >
              Account settings &rarr;
            </Link>
          </p>

          <AttentionFeed
            items={attention}
            emptyTitle="You are caught up."
            emptyBody="No payments due, no quotes waiting, no shipments arriving today. Browse the catalog to find your next part."
            emptyAction={{ label: "Browse the catalog", href: "/catalog" }}
          />

          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-head">
              <h2>Order history</h2>
              <Link className="btn btn-primary btn-sm" href="/catalog">
                Order parts
              </Link>
            </div>
            {orders.length === 0 ? (
              <div className="empty-block">
                <h3>No orders yet</h3>
                <p>When you place an order it will appear here.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Date</th>
                      <th>Items</th>
                      <th>Status</th>
                      <th className="num">Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      const isPaid =
                        o.status === "PAID" || o.status === "FULFILLED";
                      return (
                        <tr key={o.id}>
                          <td style={{ fontWeight: 700 }}>{o.reference}</td>
                          <td>{o.createdAt.toLocaleDateString()}</td>
                          <td>
                            {(() => {
                              const qtyTotal = o.items.reduce(
                                (n, i) => n + i.qty,
                                0
                              );
                              return `${qtyTotal} item${qtyTotal === 1 ? "" : "s"}`;
                            })()}
                          </td>
                          <td>
                            <span className={"badge " + (STATUS_CLASS[o.status] || "")}>
                              {o.status}
                            </span>
                          </td>
                          <td className="num">{formatCents(o.totalCents)}</td>
                          <td className="num">
                            <div
                              style={{
                                display: "inline-flex",
                                gap: 10,
                                alignItems: "center",
                                flexWrap: "wrap",
                                justifyContent: "flex-end",
                              }}
                            >
                              <Link
                                href={`/orders/${o.id}`}
                                style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
                              >
                                View
                              </Link>
                              {isPaid && (
                                <Link
                                  href={`/orders/${o.id}/invoice`}
                                  style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
                                >
                                  Invoice
                                </Link>
                              )}
                              <ReorderButton orderId={o.id} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {user.role === "BUYER" && (
            <div className="card" style={{ marginTop: 24 }}>
              <div className="card-head">
                <h2>Delivery addresses</h2>
                <Link
                  href="/settings"
                  className="muted-text"
                  style={{ fontSize: 13, textDecoration: "none" }}
                >
                  Full account settings &rarr;
                </Link>
              </div>
              <div className="card-body">
                <AddressBook initial={addresses} />
              </div>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

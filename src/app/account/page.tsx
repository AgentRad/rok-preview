import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import AddressBook from "@/components/AddressBook";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import TwoFactorSetup from "@/components/TwoFactorSetup";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  PENDING: "badge-pending",
  PAID: "badge-paid",
  FULFILLED: "badge-fulfilled",
  CANCELLED: "badge-cancelled",
};

export default async function AccountPage() {
  const user = await requireUser();
  const [orders, addresses] = await Promise.all([
    prisma.order.findMany({
      where: { buyerId: user.id },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.address.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  return (
    <>
      <SiteHeader />
      <main id="main">
        <div className="page-pad narrow">
          <h1 className="page-title">My account</h1>
          <p className="page-sub">
            Signed in as {user.name} · {user.email} · {user.role.toLowerCase()}
          </p>

          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-head">
              <h2>Change password</h2>
            </div>
            <div className="card-body">
              <ChangePasswordForm />
            </div>
          </div>

          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-head">
              <h2>Two-factor authentication</h2>
            </div>
            <div className="card-body">
              <TwoFactorSetup
                enabled={!!user.totpEnabledAt}
                enabledAt={
                  user.totpEnabledAt ? user.totpEnabledAt.toISOString() : null
                }
              />
            </div>
          </div>

          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-head">
              <h2>Delivery addresses</h2>
            </div>
            <div className="card-body">
              <AddressBook initial={addresses} />
            </div>
          </div>

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
                            {o.items.reduce((n, i) => n + i.qty, 0)} item
                            {o.items.length === 1 ? "" : "s"}
                          </td>
                          <td>
                            <span className={"badge " + (STATUS_CLASS[o.status] || "")}>
                              {o.status}
                            </span>
                          </td>
                          <td className="num">{formatCents(o.totalCents)}</td>
                          <td className="num">
                            <Link
                              href={`/orders/${o.id}`}
                              style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
                            >
                              View
                            </Link>
                            {isPaid && (
                              <>
                                {" · "}
                                <Link
                                  href={`/orders/${o.id}/invoice`}
                                  style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
                                >
                                  Invoice
                                </Link>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

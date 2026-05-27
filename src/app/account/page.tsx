import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import AddressBook from "@/components/AddressBook";
import OrderHistoryTable from "@/components/OrderHistoryTable";
import AttentionFeed from "@/components/AttentionFeed";
import { getBuyerAttention } from "@/lib/attention";
export const dynamic = "force-dynamic";

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
  // PLH-3j P10: pagination. Initial load takes the first 25; the
  // OrderHistoryTable client fetches subsequent pages via
  // /api/account/orders?page=N.
  const PAGE_SIZE = 25;
  const [orders, totalOrderCount, attention, addresses] = await Promise.all([
    prisma.order.findMany({
      where: { buyerId: user.id },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
    prisma.order.count({ where: { buyerId: user.id } }),
    getBuyerAttention(user.id),
    user.role === "BUYER"
      ? prisma.address.findMany({
          where: { userId: user.id, deletedAt: null },
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
            <OrderHistoryTable
              initial={orders.map((o) => ({
                id: o.id,
                reference: o.reference,
                createdAt: o.createdAt.toISOString(),
                status: o.status,
                totalCents: o.totalCents,
                qtyTotal: o.items.reduce((n, i) => n + i.qty, 0),
              }))}
              totalCount={totalOrderCount}
              pageSize={PAGE_SIZE}
            />
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

import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import ApplicationReview from "@/components/ApplicationReview";
import ReturnActions from "@/components/ReturnActions";
import AddSupplierForm from "@/components/AddSupplierForm";
import SupplierAdminRow from "@/components/SupplierAdminRow";
import AttentionFeed from "@/components/AttentionFeed";
import TaxExemptReview from "@/components/TaxExemptReview";
import SupplierDocsReview from "@/components/SupplierDocsReview";
import { getAdminAttention } from "@/lib/attention";
import { formatCents } from "@/lib/money";
import { computeReadiness } from "@/lib/supplier-access";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  PENDING: "badge-pending",
  PAID: "badge-paid",
  FULFILLED: "badge-fulfilled",
  CANCELLED: "badge-cancelled",
  OPEN: "badge-pending",
  QUOTED: "badge-paid",
  ACCEPTED: "badge-fulfilled",
  DECLINED: "badge-cancelled",
  ISSUED: "badge-pending",
  VOID: "badge-cancelled",
  OPEN_RMA: "badge-pending",
  APPROVED_RMA: "badge-approved",
  REJECTED_RMA: "badge-cancelled",
  RESOLVED: "badge-fulfilled",
  APPROVED: "badge-approved",
  REJECTED: "badge-cancelled",
};

export default async function AdminConsole() {
  await requireRole("ADMIN");

  const [orders, paidAgg, applications, suppliers, productCount, quotes, invoices, returns, taxExemptAddresses, supplierDocs, attention] =
    await Promise.all([
      prisma.order.findMany({
        include: { items: true },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
      prisma.order.aggregate({
        where: { status: { in: ["PAID", "FULFILLED"] } },
        _sum: { totalCents: true, feeCents: true },
        _count: true,
      }),
      prisma.supplierApplication.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.supplier.findMany({
        include: {
          _count: { select: { products: true } },
          documents: { select: { kind: true, status: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.product.count(),
      prisma.quoteRequest.findMany({
        include: { product: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.invoice.findMany({
        include: { order: { select: { reference: true } } },
        orderBy: { issuedAt: "desc" },
        take: 12,
      }),
      prisma.returnRequest.findMany({
        include: {
          order: {
            select: {
              reference: true,
              buyerName: true,
              totalCents: true,
              refundedCents: true,
            },
          },
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 12,
      }),
      prisma.address.findMany({
        where: { taxExemptCertificateUrl: { not: null }, deletedAt: null },
        include: { user: { select: { name: true, email: true } } },
        orderBy: [
          // PENDING float to the top; APPROVED / REJECTED below.
          { taxExemptStatus: "asc" },
          { createdAt: "desc" },
        ],
        take: 30,
      }),
      prisma.supplierDocument.findMany({
        include: { supplier: { select: { name: true } } },
        // PENDING float to the top so admin sees what needs review first.
        orderBy: [{ status: "asc" }, { uploadedAt: "desc" }],
        take: 60,
      }),
      getAdminAttention(),
    ]);

  const gmv = paidAgg._sum.totalCents || 0;
  const revenue = paidAgg._sum.feeCents || 0;

  return (
    <main id="main" className="app-page">
      <div className="page-pad">
        <h1 className="page-title">Admin console</h1>
          <p className="page-sub">
            Marketplace operations: suppliers, applications, and orders.{" "}
            <Link href="/ops" style={{ color: "var(--blue)", fontWeight: 600 }}>
              Open fulfillment ops →
            </Link>{" "}
            ·{" "}
            <Link
              href="/admin/audit"
              style={{ color: "var(--blue)", fontWeight: 600 }}
            >
              Audit log →
            </Link>{" "}
            ·{" "}
            <Link
              href="/admin/profit"
              style={{ color: "var(--blue)", fontWeight: 600 }}
            >
              Profit dashboard →
            </Link>{" "}
            ·{" "}
            <Link
              href="/admin/tax-registrations"
              style={{ color: "var(--blue)", fontWeight: 600 }}
            >
              Tax registrations →
            </Link>
          </p>

          <AttentionFeed
            items={attention}
            emptyTitle="Marketplace is calm."
            emptyBody="No pending applications, no open disputes, no overdue shipments. Good day to onboard a new supplier."
            emptyAction={{ label: "Add a supplier", href: "/admin" }}
          />

          <div className="kpi-grid">
            <div className="kpi">
              <div className="k-label">GMV (paid)</div>
              <div className="k-value">{formatCents(gmv)}</div>
              <div className="k-foot">{paidAgg._count} paid orders</div>
            </div>
            <div className="kpi">
              <div className="k-label">Marketplace revenue</div>
              <div className="k-value">{formatCents(revenue)}</div>
              <div className="k-foot">Marketplace fees collected</div>
            </div>
            <div className="kpi">
              <div className="k-label">Suppliers</div>
              <div className="k-value">{suppliers.length}</div>
              <div className="k-foot">{productCount} listings</div>
            </div>
            <div className="kpi">
              <div className="k-label">Pending applications</div>
              <div className="k-value">{applications.length}</div>
              <div className="k-foot">awaiting review</div>
            </div>
          </div>

          <AddSupplierForm />

          <div className="card">
            <div className="card-head">
              <h2>Supplier applications</h2>
            </div>
            <ApplicationReview
              applications={applications.map((a) => ({
                id: a.id,
                companyName: a.companyName,
                contactName: a.contactName,
                email: a.email,
                category: a.category,
                yearsTrading: a.yearsTrading,
                certs: a.certs,
                createdAt: a.createdAt.toISOString(),
              }))}
            />
          </div>

          <div className="card" id="orders">
            <div className="card-head">
              <h2>Recent orders</h2>
              <a
                href="/api/admin/orders.csv"
                className="btn btn-ghost btn-sm"
                download
              >
                Export all orders (CSV)
              </a>
            </div>
            {orders.length === 0 ? (
              <div className="empty-block">
                <h3>No orders yet</h3>
                <p>Orders placed across the marketplace appear here.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Buyer</th>
                      <th>Date</th>
                      <th>Items</th>
                      <th>Status</th>
                      <th className="num">Total</th>
                      <th className="num">Fee</th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td style={{ fontWeight: 700 }}>{o.reference}</td>
                        <td>
                          <div style={{ fontSize: 13 }}>{o.buyerName}</div>
                          <div className="muted-text" style={{ fontSize: 11.5 }}>
                            {o.buyerEmail}
                          </div>
                        </td>
                        <td>{o.createdAt.toLocaleDateString()}</td>
                        <td>{o.items.reduce((n, i) => n + i.qty, 0)}</td>
                        <td>
                          <span className={"badge " + (STATUS_CLASS[o.status] || "")}>
                            {o.status}
                          </span>
                        </td>
                        <td className="num">{formatCents(o.totalCents)}</td>
                        <td className="num">{formatCents(o.feeCents)}</td>
                        <td className="num">
                          <Link
                            href={`/orders/${o.id}`}
                            style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
                          >
                            View
                          </Link>
                          <span className="muted-text" style={{ margin: "0 6px" }}>·</span>
                          <Link
                            href={`/orders/${o.id}#messages`}
                            style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
                          >
                            Messages
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" id="invoices">
            <div className="card-head">
              <h2>Invoices</h2>
              {invoices.length > 0 && (
                <div className="row-gap">
                  <a
                    href="/api/admin/invoices-quickbooks.csv"
                    className="btn btn-ghost btn-sm"
                    download
                  >
                    Export for QuickBooks (CSV)
                  </a>
                  <a
                    href="/api/admin/invoices.csv"
                    className="btn btn-ghost btn-sm"
                    download
                  >
                    All invoice lines (CSV)
                  </a>
                </div>
              )}
            </div>
            {invoices.length === 0 ? (
              <div className="empty-block">
                <h3>No invoices yet</h3>
                <p>Invoices are issued automatically when an order is paid.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Order</th>
                      <th>Buyer</th>
                      <th>Issued</th>
                      <th>Status</th>
                      <th className="num">Total</th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td style={{ fontWeight: 700 }}>{inv.number}</td>
                        <td>{inv.order.reference}</td>
                        <td>
                          <div style={{ fontSize: 13 }}>{inv.buyerName}</div>
                          <div className="muted-text" style={{ fontSize: 11.5 }}>
                            {inv.buyerEmail}
                          </div>
                        </td>
                        <td>{inv.issuedAt.toLocaleDateString()}</td>
                        <td>
                          <span className={"badge " + (STATUS_CLASS[inv.status] || "")}>
                            {inv.status}
                          </span>
                        </td>
                        <td className="num">{formatCents(inv.totalCents)}</td>
                        <td className="num">
                          <Link
                            href={`/orders/${inv.orderId}/invoice`}
                            style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" id="returns">
            <div className="card-head">
              <h2>Return requests</h2>
            </div>
            {returns.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>RMA</th>
                      <th>Order</th>
                      <th>Buyer</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {returns.map((r) => (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 700 }}>{r.reference}</td>
                        <td>{r.order.reference}</td>
                        <td>{r.order.buyerName}</td>
                        <td>
                          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.reason}</div>
                          {r.details && (
                            <div className="muted-text" style={{ fontSize: 12 }}>
                              {r.details}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={"badge " + (STATUS_CLASS[r.status] || "")}>
                            {r.status}
                          </span>
                        </td>
                        <td>
                          {r.status !== "RESOLVED" && r.status !== "REJECTED" ? (
                            <ReturnActions
                              returnId={r.id}
                              defaultRefundCents={Math.max(
                                0,
                                r.order.totalCents - r.order.refundedCents
                              )}
                            />
                          ) : r.adminNote ? (
                            <span className="muted-text" style={{ fontSize: 12 }}>
                              {r.adminNote}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted-text" style={{ fontSize: 13.5 }}>
                No return requests right now. RMAs from buyers land here for
                approve or reject decisions.
              </p>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Supplier documents review</h2>
              {supplierDocs.filter((d) => d.status === "PENDING").length > 0 && (
                <span className="muted-text" style={{ fontSize: 13 }}>
                  {supplierDocs.filter((d) => d.status === "PENDING").length}{" "}
                  pending review
                </span>
              )}
            </div>
            <SupplierDocsReview
              rows={supplierDocs.map((d) => ({
                id: d.id,
                supplierId: d.supplierId,
                supplierName: d.supplier.name,
                kind: d.kind,
                filename: d.filename,
                url: d.url,
                status: d.status,
                reviewNote: d.reviewNote,
                uploadedAt: d.uploadedAt.toISOString(),
                reviewedAt: d.reviewedAt
                  ? d.reviewedAt.toISOString()
                  : null,
                reviewedBy: d.reviewedBy,
              }))}
            />
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Tax-exempt certificates</h2>
              {taxExemptAddresses.filter((a) => a.taxExemptStatus === "PENDING").length > 0 && (
                <span className="muted-text" style={{ fontSize: 13 }}>
                  {taxExemptAddresses.filter((a) => a.taxExemptStatus === "PENDING").length} pending review
                </span>
              )}
            </div>
            <TaxExemptReview
              rows={taxExemptAddresses.map((a) => ({
                id: a.id,
                certificateUrl: a.taxExemptCertificateUrl || "",
                status: a.taxExemptStatus || "PENDING",
                label: a.label,
                recipient: a.recipient,
                company: a.company,
                city: a.city,
                region: a.region,
                postalCode: a.postalCode,
                buyerName: a.user?.name || "",
                buyerEmail: a.user?.email || "",
                createdAt: a.createdAt.toISOString(),
              }))}
            />
          </div>

          <div className="card" id="quotes">
            <div className="card-head">
              <h2>Quote requests</h2>
            </div>
            {quotes.length === 0 ? (
              <div className="empty-block">
                <h3>No quote requests yet</h3>
                <p>RFQs for quote-only equipment appear here.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Product</th>
                      <th>Buyer</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map((q) => (
                      <tr key={q.id}>
                        <td style={{ fontWeight: 700 }}>{q.reference}</td>
                        <td style={{ fontSize: 13 }}>{q.product.name}</td>
                        <td>
                          <div style={{ fontSize: 13 }}>{q.buyerName}</div>
                          <div className="muted-text" style={{ fontSize: 11.5 }}>
                            {q.buyerEmail}
                          </div>
                        </td>
                        <td>{q.createdAt.toLocaleDateString()}</td>
                        <td>
                          <span className={"badge " + (STATUS_CLASS[q.status] || "")}>
                            {q.status}
                          </span>
                        </td>
                        <td className="num">
                          <Link
                            href={`/quotes/${q.id}`}
                            style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" id="suppliers">
            <div className="card-head">
              <h2>Suppliers</h2>
              <span className="muted-text" style={{ fontSize: 12.5 }}>
                Edit profile or Manage as to operate their dashboard
              </span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th className="num">Rating</th>
                    <th className="num">Listings</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => {
                    const r = computeReadiness(
                      {
                        status: s.status,
                        logoUrl: s.logoUrl,
                        description: s.description,
                        certifications: s.certifications,
                        website: s.website,
                        bankInfoStatus: s.bankInfoStatus,
                        stripePayoutsEnabled: s.stripePayoutsEnabled,
                        stripeAccountId: s.stripeAccountId,
                      },
                      s.documents,
                      s._count.products
                    );
                    return (
                      <SupplierAdminRow
                        key={s.id}
                        supplier={{
                          id: s.id,
                          name: s.name,
                          contactEmail: s.contactEmail,
                          certifications: s.certifications,
                          logoUrl: s.logoUrl,
                          website: s.website,
                          description: s.description,
                          status: s.status,
                          rating: s.rating,
                          onTimeRate: s.onTimeRate,
                          productCount: s._count.products,
                          publicVisible: s.publicVisible,
                          bankInfoStatus: s.bankInfoStatus,
                          bankInfoLast4: s.bankInfoLast4,
                          bankInfoBankName: s.bankInfoBankName,
                          bankInfoType: s.bankInfoType,
                          bankInfoNote: s.bankInfoNote,
                          readinessDone: r.done,
                          readinessTotal: r.total,
                          readinessMissing: r.items
                            .filter((i) => !i.done)
                            .map((i) => i.label),
                        }}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
    </main>
  );
}

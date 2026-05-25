import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureInvoiceForOrder } from "@/lib/order-utils";
import { getCurrentUser } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const INVOICE_STATUS_CLASS: Record<string, string> = {
  ISSUED: "badge-pending",
  PAID: "badge-paid",
  VOID: "badge-cancelled",
};

export default async function OrderInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, invoice: true },
  });
  if (!order) notFound();

  const user = await getCurrentUser();
  if (!user) redirect(`/login`);

  const isAdmin = user.role === "ADMIN";
  const isOwner = !!order.buyerId && order.buyerId === user.id;
  if (!isAdmin && !isOwner) notFound();

  if (order.status === "PENDING" || order.status === "CANCELLED") {
    return (
      <>
        <SiteHeader />
        <main id="main" className="app-page">
          <div className="page-pad narrow">
            <div className="alert alert-info">
              Order {order.reference} has no invoice yet. Invoices are issued
              after payment is received.
            </div>
            <div style={{ marginTop: 16 }}>
              <Link className="btn btn-ghost" href={`/orders/${order.id}`}>
                Back to order
              </Link>
            </div>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  let invoice = order.invoice;
  if (!invoice) {
    await ensureInvoiceForOrder(order.id);
    invoice = await prisma.invoice.findUnique({ where: { orderId: order.id } });
  }
  if (!invoice) notFound();

  return (
    <>
      <div className="no-print">
        <SiteHeader />
      </div>
      <main id="main" className="app-page">
      <div className="page-pad narrow invoice-page">
        <div className="invoice-toolbar no-print">
          <Link className="btn btn-ghost btn-sm" href={`/orders/${order.id}`}>
            Back to order
          </Link>
          <PrintButton />
        </div>

        <div className="invoice invoice-doc">
          <div className="invoice-head">
            <div>
              <h2>PartsPort</h2>
              <div className="muted-text" style={{ fontSize: 13 }}>
                The Industrial Parts Marketplace
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="invoice-meta-label">Invoice</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>
                {invoice.number}
              </div>
              <div className="muted-text" style={{ fontSize: 12.5 }}>
                Issued {invoice.issuedAt.toLocaleDateString()}
              </div>
              <div
                className={
                  "badge " + (INVOICE_STATUS_CLASS[invoice.status] || "")
                }
                style={{ marginTop: 6 }}
              >
                {invoice.status}
              </div>
            </div>
          </div>

          <div className="grid-2 invoice-grid">
            <div>
              <div className="invoice-meta-label">Billed to</div>
              <div style={{ marginTop: 4, fontWeight: 600 }}>
                {invoice.buyerName}
              </div>
              <div className="muted-text" style={{ fontSize: 13 }}>
                {invoice.buyerEmail}
              </div>
            </div>
            <div>
              <div className="invoice-meta-label">Deliver to</div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 13.5,
                  whiteSpace: "pre-line",
                }}
              >
                {invoice.shipTo}
              </div>
            </div>
          </div>

          <div className="grid-2 invoice-grid">
            <div>
              <div className="invoice-meta-label">Order reference</div>
              <div style={{ marginTop: 4, fontWeight: 700 }}>
                {order.reference}
              </div>
              <div className="muted-text" style={{ fontSize: 12.5 }}>
                Placed {order.createdAt.toLocaleDateString()}
              </div>
            </div>
            <div>
              <div className="invoice-meta-label">Payment</div>
              <div style={{ marginTop: 4, fontWeight: 600 }}>
                {order.paymentMethod}
              </div>
              <div className="muted-text" style={{ fontSize: 12.5 }}>
                {order.paidAt
                  ? `Received ${order.paidAt.toLocaleDateString()}`
                  : "Confirmed"}
              </div>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Supplier</th>
                  <th className="num">Unit price</th>
                  <th className="num">Qty</th>
                  <th className="num">Line total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{it.nameSnapshot}</div>
                      <div className="muted-text" style={{ fontSize: 12 }}>
                        {it.skuSnapshot}
                      </div>
                    </td>
                    <td>{it.supplierName}</td>
                    <td className="num">{formatCents(it.unitPriceCents)}</td>
                    <td className="num">{it.qty}</td>
                    <td className="num">
                      {formatCents(it.unitPriceCents * it.qty)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="invoice-totals">
            <div className="summary-line">
              <span>Subtotal</span>
              <span>{formatCents(invoice.subtotalCents)}</span>
            </div>
            <div className="summary-line">
              <span>Freight</span>
              <span>{formatCents(invoice.freightCents)}</span>
            </div>
            <div className="summary-line">
              <span>
                Platform fee ({(order.feeRateBps / 100).toFixed(order.feeRateBps % 100 === 0 ? 0 : 1)}%)
              </span>
              <span>{formatCents(invoice.feeCents)}</span>
            </div>
            <div className="summary-line">
              <span>Sales tax</span>
              <span>{formatCents(invoice.taxCents)}</span>
            </div>
            <div className="summary-line total">
              <span>Total</span>
              <span>{formatCents(invoice.totalCents)}</span>
            </div>
          </div>

          <div className="invoice-footer">
            <p className="muted-text" style={{ fontSize: 12.5 }}>
              PartsPort holds payment and releases the part price to the
              supplier on dispatch, retaining the platform fee. Sales tax is
              remitted to the relevant state. This invoice covers the
              marketplace transaction. Questions:
              support@partsport.agentgaming.gg
            </p>
          </div>
        </div>
      </div>
      </main>
      <div className="no-print">
        <SiteFooter />
      </div>
    </>
  );
}

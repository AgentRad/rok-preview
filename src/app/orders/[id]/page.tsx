import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import PayOrder from "@/components/PayOrder";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  PENDING: "badge-pending",
  PAID: "badge-paid",
  FULFILLED: "badge-fulfilled",
  CANCELLED: "badge-cancelled",
};

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!order) notFound();

  const paid = order.status !== "PENDING" && order.status !== "CANCELLED";
  const fulfilled = order.status === "FULFILLED";

  return (
    <>
      <SiteHeader />
      <main id="main">
        <div className="page-pad narrow">
          {paid && (
            <div className="alert alert-ok">
              ✓ Payment received. Thank you. Order {order.reference} is
              confirmed and routed to the supplier.
            </div>
          )}
          {!paid && order.status === "PENDING" && (
            <div className="alert alert-info">
              Order {order.reference} is awaiting payment. Review the details
              below and pay to confirm.
            </div>
          )}

          <div className="order-steps">
            <div className="order-step done">
              <div className="os-label">Order placed</div>
              <div className="os-sub">{order.createdAt.toLocaleDateString()}</div>
            </div>
            <div className={"order-step" + (paid ? " done" : "")}>
              <div className="os-label">Payment {paid ? "received" : "pending"}</div>
              <div className="os-sub">
                {order.paidAt ? order.paidAt.toLocaleDateString() : "Pending"}
              </div>
            </div>
            <div className={"order-step" + (fulfilled ? " done" : "")}>
              <div className="os-label">
                {fulfilled ? "Dispatched" : "Awaiting dispatch"}
              </div>
              <div className="os-sub">
                {fulfilled ? "On the way to you" : "Supplier preparing order"}
              </div>
            </div>
          </div>

          <div className="invoice">
            <div className="invoice-head">
              <div>
                <h2>PartsPort</h2>
                <div className="muted-text" style={{ fontSize: 13 }}>
                  Order invoice
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>
                  {order.reference}
                </div>
                <div className={"badge " + (STATUS_CLASS[order.status] || "")}>
                  {order.status}
                </div>
              </div>
            </div>

            <div className="grid-2" style={{ marginBottom: 22 }}>
              <div>
                <div className="muted-text" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>
                  Billed to
                </div>
                <div style={{ marginTop: 4, fontWeight: 600 }}>
                  {order.buyerName}
                </div>
                <div className="muted-text" style={{ fontSize: 13 }}>
                  {order.buyerEmail}
                </div>
              </div>
              <div>
                <div className="muted-text" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>
                  Deliver to
                </div>
                <div style={{ marginTop: 4, fontSize: 13.5, whiteSpace: "pre-line" }}>
                  {order.shipTo}
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

            <div style={{ maxWidth: 300, marginLeft: "auto", marginTop: 18 }}>
              <div className="summary-line">
                <span>Subtotal</span>
                <span>{formatCents(order.subtotalCents)}</span>
              </div>
              <div className="summary-line">
                <span>Freight</span>
                <span>{formatCents(order.freightCents)}</span>
              </div>
              <div className="summary-line">
                <span>Platform fee</span>
                <span>{formatCents(order.feeCents)}</span>
              </div>
              <div className="summary-line">
                <span>Sales tax</span>
                <span>{formatCents(order.taxCents)}</span>
              </div>
              <div className="summary-line total">
                <span>Total</span>
                <span>{formatCents(order.totalCents)}</span>
              </div>
            </div>

            <p className="muted-text" style={{ fontSize: 12.5, marginTop: 20 }}>
              Payment method: {order.paymentMethod}. PartsPort holds payment and
              releases the part price to the supplier on dispatch, retaining
              the platform fee.
            </p>
          </div>

          {order.status === "PENDING" && (
            <PayOrder
              orderId={order.id}
              totalCents={order.totalCents}
              paypalClientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || ""}
            />
          )}

          <div style={{ marginTop: 24 }} className="row-gap">
            {paid && (
              <Link className="btn btn-dark" href={`/orders/${order.id}/invoice`}>
                View invoice
              </Link>
            )}
            <Link className="btn btn-ghost" href="/catalog">
              Continue shopping
            </Link>
            <Link className="btn btn-ghost" href="/account">
              View my orders
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

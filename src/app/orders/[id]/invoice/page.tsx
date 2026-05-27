import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureInvoiceForOrder } from "@/lib/order-utils";
import { getCurrentUser } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { SURCHARGE_CENTS } from "@/lib/freight";
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: { include: { product: { include: { supplier: true } } } },
      invoice: true,
      supplierSlots: {
        include: { supplier: { select: { id: true, name: true, logoUrl: true } } },
      },
    },
  });
  if (!order) notFound();

  const user = await getCurrentUser();
  // PLH-3c F4: guest-token invoice access. Outbound order emails for
  // guest orders carry a signed `?t=` token bound to the buyer email.
  // When present and valid we skip the login redirect and render the
  // invoice for the guest.
  const guestToken = typeof sp.t === "string" ? sp.t : "";
  let isGuestViaToken = false;
  if (guestToken) {
    const { verifyOrderViewToken } = await import("@/lib/order-link");
    isGuestViaToken = verifyOrderViewToken(order.id, order.buyerEmail, guestToken);
  }
  if (!user && !isGuestViaToken) redirect(`/login`);

  const isAdmin = user?.role === "ADMIN";
  const isOwner = !!user && !!order.buyerId && order.buyerId === user.id;
  if (!isAdmin && !isOwner && !isGuestViaToken) notFound();

  if (order.status === "PENDING" || order.status === "CANCELLED") {
    return (
      <>
        <SiteHeader />
        <main id="main" className="app-page">
          <div className="page-pad narrow">
            <h1 style={{ marginBottom: 16 }}>
              {order.status === "PENDING" ? "Invoice pending" : "No invoice"}
            </h1>
            <div className="alert alert-info">
              <strong>
                {order.status === "PENDING"
                  ? "No invoice issued yet."
                  : "No invoice for this order."}
              </strong>
              <br />
              Order {order.reference} is{" "}
              {order.status === "PENDING" ? "awaiting payment" : "cancelled"}.{" "}
              {order.status === "PENDING"
                ? "An invoice is created automatically once payment is received."
                : "Cancelled orders never receive an invoice."}
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
        <h1 className="sr-only">Invoice {invoice.number}</h1>
        <div className="invoice-toolbar no-print">
          <Link className="btn btn-ghost btn-sm" href={`/orders/${order.id}`}>
            Back to order
          </Link>
          <PrintButton />
        </div>

        <div className="invoice invoice-doc">
          <div className="invoice-head">
            <div className="invoice-brand">
              <svg className="invoice-mark" viewBox="0 0 64 64" aria-hidden="true">
                <path
                  d="M32 10 51.5 21.5v23L32 56 12.5 44.5v-23Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.4"
                  strokeLinejoin="round"
                />
                <circle cx="32" cy="32" r="7" fill="#e0a32a" />
              </svg>
              <div>
                <div className="invoice-brand-name">PartsPort</div>
                <div className="muted-text" style={{ fontSize: 13 }}>
                  The Industrial Parts Marketplace
                </div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="invoice-doc-label">Invoice</div>
              <div style={{ fontWeight: 700, fontSize: 24, letterSpacing: "-.02em" }}>
                {invoice.number}
              </div>
              <div className="muted-text" style={{ fontSize: 12.5, marginTop: 2 }}>
                Issued {invoice.issuedAt.toLocaleDateString()}
              </div>
              <div
                className={
                  "badge " + (INVOICE_STATUS_CLASS[invoice.status] || "")
                }
                style={{ marginTop: 8 }}
              >
                {invoice.status}
              </div>
            </div>
          </div>

          <div className="grid-2 invoice-grid">
            <div>
              <div className="invoice-meta-label">Billed to</div>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginTop: 4 }}>
                {order.buyerCompanyLogoUrl && (
                  <span className="invoice-buyer-logo" aria-hidden="true">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={order.buyerCompanyLogoUrl}
                      alt={`${order.buyerCompanyName ?? "Buyer"} logo`}
                    />
                  </span>
                )}
                <div>
                  {order.buyerCompanyName && (
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {order.buyerCompanyName}
                    </div>
                  )}
                  <div style={{ fontWeight: 600 }}>{invoice.buyerName}</div>
                  <div className="muted-text" style={{ fontSize: 13 }}>
                    {invoice.buyerEmail}
                  </div>
                </div>
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

          {order.supplierSlots.length > 1 ? (
            <div className="invoice-supplier-sections">
              {order.supplierSlots.map((slot) => {
                const items = order.items.filter(
                  (it) => it.product.supplierId === slot.supplierId
                );
                return (
                  <div key={slot.id} className="invoice-supplier-section" style={{ marginTop: 12 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        margin: "14px 0 8px",
                        paddingBottom: 6,
                        borderBottom: "1px solid var(--line)",
                      }}
                    >
                      {slot.supplier?.logoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={slot.supplier.logoUrl}
                          alt=""
                          className="invoice-supplier-logo"
                        />
                      )}
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        {slot.supplier?.name || "Supplier"}
                      </div>
                    </div>
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Part</th>
                            <th className="num">Unit price</th>
                            <th className="num">Qty</th>
                            <th className="num">Line total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it) => (
                            <tr key={it.id}>
                              <td>
                                <div style={{ fontWeight: 600 }}>
                                  {it.nameSnapshot}
                                </div>
                                <div className="muted-text" style={{ fontSize: 12 }}>
                                  {it.skuSnapshot}
                                </div>
                              </td>
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
                    <div style={{ maxWidth: 280, marginLeft: "auto", marginTop: 6 }}>
                      <div className="summary-line">
                        <span>Section subtotal</span>
                        <span>{formatCents(slot.subtotalCents)}</span>
                      </div>
                      <div className="summary-line">
                        <span>Section freight</span>
                        <span>{formatCents(slot.freightCents)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
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
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {it.product?.supplier?.logoUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={it.product.supplier.logoUrl}
                              alt=""
                              className="invoice-supplier-logo"
                            />
                          )}
                          <span>{it.supplierName}</span>
                        </div>
                      </td>
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
          )}

          <div className="invoice-totals">
            <div className="summary-line">
              <span>Subtotal</span>
              <span>{formatCents(invoice.subtotalCents)}</span>
            </div>
            <div className="summary-line">
              <span>
                Freight &amp; handling
                {order.freightCarrier && (
                  <span
                    className="muted-text"
                    style={{ fontSize: 11, marginLeft: 6 }}
                  >
                    {order.freightCarrier}
                    {order.freightService ? ` ${order.freightService}` : ""}
                  </span>
                )}
              </span>
              <span>{formatCents(invoice.freightCents)}</span>
            </div>
            {/* P9.5 MED 23: invoice surcharge breakdown. Pre-fix the
                invoice showed only the freight TOTAL without saying
                which carrier or which surcharges; AP teams couldn't
                reconcile $858 vs the $508 carrier quote. */}
            {order.freightSurcharges &&
              typeof order.freightSurcharges === "object" &&
              (() => {
                const s = order.freightSurcharges as {
                  liftgate?: boolean;
                  residential?: boolean;
                  insideDelivery?: boolean;
                };
                const parts: string[] = [];
                if (s.liftgate)
                  parts.push(`Liftgate (+${formatCents(SURCHARGE_CENTS.liftgate)})`);
                if (s.residential)
                  parts.push(`Residential delivery (+${formatCents(SURCHARGE_CENTS.residential)})`);
                if (s.insideDelivery)
                  parts.push(`Inside delivery (+${formatCents(SURCHARGE_CENTS.insideDelivery)})`);
                if (parts.length === 0) return null;
                return (
                  <div
                    className="muted-text"
                    style={{
                      fontSize: 11.5,
                      marginLeft: 12,
                      marginTop: 2,
                      lineHeight: 1.5,
                    }}
                  >
                    Includes: {parts.join(", ")}
                  </div>
                );
              })()}
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
              <span>Total due</span>
              <span>{formatCents(invoice.totalCents)}</span>
            </div>

            <div className="invoice-formula">
              <strong>Total math:</strong>
              <br />
              {formatCents(invoice.subtotalCents)} subtotal
              <br />
              + {formatCents(invoice.freightCents)} freight
              <br />
              + {formatCents(invoice.feeCents)} platform fee (
              {(order.feeRateBps / 100).toFixed(order.feeRateBps % 100 === 0 ? 0 : 1)}%
              )
              <br />
              + {formatCents(invoice.taxCents)} sales tax
              <br />
              = <strong>{formatCents(invoice.totalCents)}</strong>
            </div>
          </div>

          <div className="invoice-payto">
            <div className="invoice-payto-label">Remit to / Questions</div>
            <div style={{ fontWeight: 600 }}>PartsPort, Inc.</div>
            <div className="muted-text">
              The Industrial Parts Marketplace
              <br />
              support@partsport.agentgaming.gg
            </div>
          </div>

          <p className="invoice-thanks">Thank you for your order.</p>

          <div className="invoice-footer">
            <p className="muted-text" style={{ fontSize: 12.5 }}>
              PartsPort collects payment, holds funds in escrow, and releases
              the part price to the supplier on dispatch, retaining the
              platform fee. Sales tax is remitted to the relevant state. This
              invoice covers the marketplace transaction.
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

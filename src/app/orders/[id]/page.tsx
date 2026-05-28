import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import PayOrder from "@/components/PayOrder";
import ReorderButton from "@/components/ReorderButton";
import CancelOrderButton from "@/components/CancelOrderButton";
import ConfirmReceiptButton from "@/components/ConfirmReceiptButton";
import ReturnRequestForm from "@/components/ReturnRequestForm";
import MessageThread from "@/components/MessageThread";
import { visibilitiesVisibleTo, type ViewerRole } from "@/lib/message-visibility";
import { formatCents } from "@/lib/money";
import { SURCHARGE_CENTS } from "@/lib/freight";
import { trackingLink } from "@/lib/tracking";
import { isPaymentsConfigured, reconcileOrderFromStripe } from "@/lib/payments";
import { verifyOrderViewToken } from "@/lib/order-link";
import WriteReview from "@/components/WriteReview";
import DraftInvoiceWithAI from "@/components/DraftInvoiceWithAI";
import AdminEditPurchaseOrder from "@/components/AdminEditPurchaseOrder";
import ApprovalPokeButton from "@/components/ApprovalPokeButton";
import ApprovalBypassButton from "@/components/ApprovalBypassButton";

function rateLabelForOrder(order: { feeRateBps: number }): string {
  return `${(order.feeRateBps / 100).toFixed(order.feeRateBps % 100 === 0 ? 0 : 1)}%`;
}

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  PENDING: "badge-pending",
  PAID: "badge-paid",
  FULFILLED: "badge-fulfilled",
  CANCELLED: "badge-cancelled",
};

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const orderInclude = {
    items: { include: { product: { include: { supplier: true } } } },
    returns: { orderBy: { createdAt: "desc" as const } },
    messages: {
      orderBy: { createdAt: "asc" as const },
      include: { attachments: { orderBy: { createdAt: "asc" as const } } },
    },
    reviews: { select: { productId: true, rating: true, createdAt: true } },
    // PLH-3j P8: pull the most recent Refund row so the totals breakdown
    // can render "Refunded: $X.XX on <date>" below the Total line.
    refunds: {
      orderBy: { createdAt: "desc" as const },
      take: 1,
      select: { amountCents: true, createdAt: true },
    },
    supplierSlots: {
      include: { supplier: { select: { id: true, name: true, logoUrl: true } } },
    },
    approvals: {
      orderBy: { chainOrder: "asc" as const },
      select: {
        id: true,
        outcome: true,
        chainOrder: true,
        reason: true,
        decidedAt: true,
      },
    },
  };
  const initial = await prisma.order.findUnique({
    where: { id },
    include: orderInclude,
  });
  if (!initial) notFound();
  let order = initial;

  // Webhook-independent reconciliation: when the buyer returns from Stripe
  // with ?paid=1 in the URL but the order is still PENDING (the webhook may
  // be delayed, mis-configured, or signature-failing), ask Stripe directly
  // if a session for this order has been paid, and flip the order in-line
  // so the page renders honest state on first load.
  if (sp.paid === "1" && order.status === "PENDING") {
    try {
      const result = await reconcileOrderFromStripe(order.id);
      if (result.paid) {
        const reloaded = await prisma.order.findUnique({
          where: { id },
          include: orderInclude,
        });
        if (reloaded) order = reloaded;
      }
    } catch (e) {
      // Reconciliation failed; render the page as PENDING. The webhook
      // will catch up in time.
      console.error("[order] Stripe reconcile failed:", e);
    }
  }

  const viewer = await getCurrentUser();
  const isBuyer = !!viewer && !!order.buyerId && viewer.id === order.buyerId;
  const isAdmin = viewer?.role === "ADMIN";
  let isOrderSupplier = false;
  let canDraftInvoice = false;
  if (viewer?.role === "SUPPLIER") {
    const { userHasAccessToSupplier, canSendMessages } = await import(
      "@/lib/supplier-access"
    );
    const supplierIds = Array.from(
      new Set(order.items.map((it) => it.product.supplierId))
    );
    const checks = await Promise.all(
      supplierIds.map((id) => userHasAccessToSupplier(viewer.id, id))
    );
    isOrderSupplier = checks.some((c) => c.ok);
    canDraftInvoice = checks.some((c) => c.ok && canSendMessages(c.role));
  }
  if (isAdmin) canDraftInvoice = true;
  const guestToken = typeof sp.t === "string" ? sp.t : "";
  const isGuestViaToken = guestToken
    ? verifyOrderViewToken(order.id, order.buyerEmail, guestToken)
    : false;
  if (!isBuyer && !isAdmin && !isOrderSupplier && !isGuestViaToken) {
    notFound();
  }
  const canMessage = !!viewer && (isBuyer || isAdmin || isOrderSupplier);
  const viewerThreadRole: ViewerRole = isAdmin
    ? "admin"
    : isOrderSupplier
      ? "supplier"
      : isBuyer || isGuestViaToken
        ? "buyer"
        : "none";
  const visibleSet = new Set(visibilitiesVisibleTo(viewerThreadRole));
  const visibleMessages = order.messages.filter((m) => visibleSet.has(m.visibility));

  const paid = order.status !== "PENDING" && order.status !== "CANCELLED";
  const fulfilled = order.status === "FULFILLED";
  const cancellable =
    order.status === "PENDING" ||
    (order.status === "PAID" && order.shipmentStage !== "Shipped" && order.shipmentStage !== "Delivered");
  const canOpenReturn = order.status === "FULFILLED" || order.shipmentStage === "Delivered";

  const stageIndex = (() => {
    if (order.status === "PENDING" || order.status === "CANCELLED") return -1;
    if (fulfilled || order.shipmentStage === "Delivered") return 3;
    if (order.shipmentStage === "Shipped") return 2;
    if (order.shipmentStage === "Processing") return 1;
    return 0; // PAID, not yet picked up by supplier
  })();
  const trackingUrl = trackingLink(order.carrier, order.trackingCode);
  const isMultiSupplier = (order.supplierSlots?.length ?? 0) > 1;
  const slotItems = (supplierId: string) =>
    order.items.filter((it) => it.product.supplierId === supplierId);

  return (
    <>
      <SiteHeader />
      <main id="main" className="app-page">
        <div className="page-pad narrow">
          <h1 className="sr-only">Order {order.reference}</h1>
          {paid && (
            <div className="alert alert-ok">
              ✓ Payment received. Thank you. Order {order.reference} is
              confirmed and routed to the supplier.
            </div>
          )}
          {/* PLH-3y-6: approval status banners */}
          {order.approvalStatus === "PENDING" && (
            <div className="alert alert-info">
              <strong>Awaiting approval.</strong>{" "}
              This order has been submitted for review by your organization&apos;s approver.
              You will be notified once a decision is made.
              {" "}<a href="/buyer-org/approvals" style={{ color: "var(--blue)", textDecoration: "underline" }}>View approval queue</a>
              {isBuyer && (
                <span>
                  {" "}
                  <ApprovalPokeButton orderId={order.id} />
                </span>
              )}
              {isAdmin && (
                <span>
                  {" "}
                  <ApprovalBypassButton orderId={order.id} />
                </span>
              )}
            </div>
          )}
          {order.approvalStatus === "REJECTED" && (
            <div className="alert alert-error">
              <strong>Order not approved.</strong>{" "}
              {order.approvals.find((a) => a.outcome === "REJECTED")?.reason || "This order was not approved by your organization."}
            </div>
          )}
          {!paid && order.status === "PENDING" && order.approvalStatus !== "PENDING" && order.approvalStatus !== "REJECTED" && (
            <div className="alert alert-info">
              <strong>Order {order.reference} is awaiting payment.</strong>
              {" "}
              Review the details below, then{" "}
              <a
                href="#pay"
                style={{ color: "var(--blue)", fontWeight: 600, textDecoration: "underline" }}
              >
                resume payment
              </a>
              {" "}to confirm.
            </div>
          )}

          {paid && (
            <div className="order-steps">
              <div className={"order-step" + (stageIndex >= 0 ? " done" : "")}>
                <div className="os-label">Paid</div>
                <div className="os-sub">
                  {order.paidAt ? order.paidAt.toLocaleDateString() : "Confirmed"}
                </div>
              </div>
              <div className={"order-step" + (stageIndex >= 1 ? " done" : "")}>
                <div className="os-label">Processing</div>
                <div className="os-sub">
                  {stageIndex >= 1 ? "Supplier preparing order" : "Up next"}
                </div>
              </div>
              <div className={"order-step" + (stageIndex >= 2 ? " done" : "")}>
                <div className="os-label">Shipped</div>
                <div className="os-sub">
                  {stageIndex >= 2 && order.carrier
                    ? `${order.carrier} on the way`
                    : "Awaiting dispatch"}
                </div>
              </div>
              <div className={"order-step" + (stageIndex >= 3 ? " done" : "")}>
                <div className="os-label">Delivered</div>
                <div className="os-sub">
                  {stageIndex >= 3 ? "Order complete" : "Pending"}
                </div>
              </div>
            </div>
          )}

          {paid && isMultiSupplier && (
            <div className="multi-supplier-shipments" style={{ marginTop: 18 }}>
              <h2 style={{ fontSize: 18, marginBottom: 10 }}>
                Shipments from {order.supplierSlots.length} suppliers
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {order.supplierSlots.map((slot) => {
                  const items = slotItems(slot.supplierId);
                  const link = slot.trackingUrl
                    || trackingLink(slot.carrier, slot.trackingCode);
                  const slotStage = slot.shipmentStage || "Pending";
                  const slotBadge =
                    slotStage === "Delivered"
                      ? "badge-fulfilled"
                      : slotStage === "Shipped"
                      ? "badge-paid"
                      : "badge-pending";
                  return (
                    <div
                      key={slot.id}
                      className="card"
                      style={{ padding: 0 }}
                    >
                      <div
                        className="card-head"
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {slot.supplier?.logoUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={slot.supplier.logoUrl}
                              alt=""
                              className="invoice-supplier-logo"
                            />
                          )}
                          <h3 style={{ margin: 0, fontSize: 15 }}>
                            {slot.supplier?.name || "Supplier"}
                          </h3>
                        </div>
                        <span className={"badge " + slotBadge}>{slotStage}</span>
                      </div>
                      <div className="card-body">
                        <table className="table" style={{ marginTop: 0 }}>
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
                                  <div
                                    className="muted-text"
                                    style={{ fontSize: 12 }}
                                  >
                                    {it.skuSnapshot}
                                  </div>
                                </td>
                                <td className="num">
                                  {formatCents(it.unitPriceCents)}
                                </td>
                                <td className="num">{it.qty}</td>
                                <td className="num">
                                  {formatCents(it.unitPriceCents * it.qty)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div
                          style={{
                            maxWidth: 280,
                            marginLeft: "auto",
                            marginTop: 10,
                          }}
                        >
                          <div className="summary-line">
                            <span>Subtotal</span>
                            <span>{formatCents(slot.subtotalCents)}</span>
                          </div>
                          <div className="summary-line">
                            <span>Freight</span>
                            <span>{formatCents(slot.freightCents)}</span>
                          </div>
                          <div className="summary-line">
                            <span>Platform fee</span>
                            <span>{formatCents(slot.feeCents)}</span>
                          </div>
                          {slot.refundedCents > 0 && (
                            <div className="summary-line">
                              <span>Refunded</span>
                              <span>
                                {"-"}
                                {formatCents(slot.refundedCents)}
                              </span>
                            </div>
                          )}
                        </div>
                        {slot.shippedAt && slot.carrier && slot.trackingCode && (
                          <div
                            className="tracking-card"
                            style={{ marginTop: 12 }}
                          >
                            <div className="tracking-head">
                              <div>
                                <div className="invoice-meta-label">Tracking</div>
                                <div
                                  style={{
                                    fontWeight: 700,
                                    fontSize: 15,
                                    marginTop: 4,
                                  }}
                                >
                                  {slot.carrier}
                                </div>
                                <div
                                  className="muted-text"
                                  style={{
                                    fontFamily: "var(--mono)",
                                    fontSize: 13,
                                    marginTop: 2,
                                  }}
                                >
                                  {slot.trackingCode}
                                </div>
                              </div>
                              {link && (
                                <a
                                  className="btn btn-dark btn-sm"
                                  href={link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Track shipment
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                        <div
                          className="muted-text"
                          style={{ fontSize: 12, marginTop: 10 }}
                        >
                          {slot.shippedAt
                            ? `Shipped ${slot.shippedAt.toLocaleDateString()}`
                            : "Awaiting dispatch"}
                          {slot.deliveredAt
                            ? ` · Delivered ${slot.deliveredAt.toLocaleDateString()}`
                            : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {paid && !isMultiSupplier && stageIndex >= 2 && order.carrier && order.trackingCode && (
            <div className="tracking-card">
              <div className="tracking-head">
                <div>
                  <div className="invoice-meta-label">Tracking</div>
                  <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>
                    {order.carrier}
                  </div>
                  <div
                    className="muted-text"
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 13,
                      marginTop: 2,
                    }}
                  >
                    {order.trackingCode}
                  </div>
                </div>
                {trackingUrl && (
                  <a
                    className="btn btn-dark btn-sm"
                    href={trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Track shipment
                  </a>
                )}
              </div>
              <p className="muted-text" style={{ fontSize: 12.5, marginTop: 12 }}>
                For LTL freight deliveries, inspect the shipment on arrival and
                note any damage on the carrier delivery receipt before signing.
                Report claims within the window in the supplier agreement.
              </p>
              {isBuyer && order.shipmentStage === "Shipped" && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                  <div style={{ fontSize: 13.5, marginBottom: 8 }}>
                    Already received your shipment? Confirm it below so the
                    review window opens and the order closes out.
                  </div>
                  <ConfirmReceiptButton orderId={order.id} />
                </div>
              )}
            </div>
          )}

          <div className="invoice">
            <div className="invoice-head">
              <div>
                <h2>PartsPort</h2>
                <div className="muted-text" style={{ fontSize: 13 }}>
                  Order invoice
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>
                  {order.reference}
                </div>
                {order.purchaseOrderNumber && (
                  <div
                    className="muted-text"
                    style={{ fontSize: 12.5, marginTop: 2 }}
                  >
                    PO #: {order.purchaseOrderNumber}
                  </div>
                )}
                <div className={"badge " + (STATUS_CLASS[order.status] || "")}>
                  {order.status}
                </div>
                {isAdmin && (
                  <AdminEditPurchaseOrder
                    orderId={order.id}
                    initial={order.purchaseOrderNumber || ""}
                  />
                )}
              </div>
            </div>

            <div className="grid-2" style={{ marginBottom: 22 }}>
              <div>
                <div className="muted-text" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>
                  Billed to
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 4 }}>
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
                      <div style={{ fontWeight: 700 }}>
                        {order.buyerCompanyName}
                      </div>
                    )}
                    <div style={{ fontWeight: 600 }}>{order.buyerName}</div>
                    <div className="muted-text" style={{ fontSize: 13 }}>
                      {order.buyerEmail}
                    </div>
                  </div>
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

            <div style={{ maxWidth: 300, marginLeft: "auto", marginTop: 18 }}>
              <div className="summary-line">
                <span>Subtotal</span>
                <span>{formatCents(order.subtotalCents)}</span>
              </div>
              <div className="summary-line">
                <span>
                  Freight
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
                <span>{formatCents(order.freightCents)}</span>
              </div>
              {Array.isArray(order.freightBreakdown) &&
                order.freightBreakdown.length > 1 && (
                  <div className="freight-breakdown" style={{ maxWidth: 300 }}>
                    {(order.freightBreakdown as Array<{
                      supplierName?: string;
                      carrier?: string;
                      service?: string;
                      cents?: number;
                    }>).map((s, idx) => (
                      <div key={idx} className="freight-breakdown-line">
                        <span className="freight-breakdown-supplier">
                          {s.supplierName || "Shipment"}
                          {s.carrier ? `: ${s.carrier} ${s.service || ""}` : ""}
                        </span>
                        <span>{formatCents(s.cents || 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
              {order.freightSurcharges &&
                typeof order.freightSurcharges === "object" &&
                (() => {
                  const s = order.freightSurcharges as {
                    liftgate?: boolean;
                    residential?: boolean;
                    insideDelivery?: boolean;
                  };
                  const parts: { label: string; cents: number }[] = [];
                  // P9.5 MED 27: pull from lib/freight constants instead
                  // of hardcoding. Three call sites previously kept their
                  // own copy of these numbers.
                  if (s.liftgate)
                    parts.push({ label: "Liftgate", cents: SURCHARGE_CENTS.liftgate });
                  if (s.residential)
                    parts.push({ label: "Residential delivery", cents: SURCHARGE_CENTS.residential });
                  if (s.insideDelivery)
                    parts.push({ label: "Inside delivery", cents: SURCHARGE_CENTS.insideDelivery });
                  if (parts.length === 0) return null;
                  return (
                    <div
                      className="muted-text"
                      style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}
                    >
                      Includes:{" "}
                      {parts
                        .map((p) => `${p.label} (+${formatCents(p.cents)})`)
                        .join(", ")}
                    </div>
                  );
                })()}
              <div className="summary-line">
                <span>Platform fee ({rateLabelForOrder(order)})</span>
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
              {/* PLH-3j P8: surface refund amount + date on the buyer's
                  order page. Order.refundedCents was already tracked but
                  never rendered. Pull the most recent Refund row for the
                  date so the buyer can see when the money was returned. */}
              {order.refundedCents > 0 && (
                <div
                  className="summary-line"
                  style={{ color: "var(--blue)", marginTop: 6 }}
                >
                  <span>
                    Refunded
                    {order.refunds[0]?.createdAt
                      ? ` on ${new Date(order.refunds[0].createdAt).toLocaleDateString()}`
                      : ""}
                  </span>
                  <span>{formatCents(order.refundedCents)}</span>
                </div>
              )}
              {order.taxCents === 0 && order.status === "PENDING" && (
                <p
                  className="muted-text"
                  style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.4 }}
                >
                  Sales tax is calculated at checkout for live payment methods.
                </p>
              )}
            </div>

            <p className="muted-text" style={{ fontSize: 12.5, marginTop: 20 }}>
              Payment method: {order.paymentMethod}. PartsPort holds payment and
              releases the part price to the supplier on dispatch, retaining
              the platform fee.
            </p>
          </div>

          {order.status === "PENDING" && (
            <div id="pay">
              <PayOrder
                orderId={order.id}
                totalCents={order.totalCents}
                paypalClientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || ""}
                paymentsConfigured={isPaymentsConfigured()}
              />
            </div>
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
            {paid && isBuyer && <ReorderButton orderId={order.id} />}
            {cancellable && <CancelOrderButton orderId={order.id} />}
            {canDraftInvoice && process.env.ANTHROPIC_API_KEY && (
              <DraftInvoiceWithAI orderId={order.id} />
            )}
          </div>

          {order.status === "CANCELLED" && (
            <div className="alert alert-error" style={{ marginTop: 24 }}>
              This order has been cancelled
              {order.cancelledAt
                ? ` on ${order.cancelledAt.toLocaleDateString()}`
                : ""}
              . The invoice has been voided.
            </div>
          )}

          {canMessage && viewer && (await (async () => {
            const seen = await prisma.threadLastRead.findFirst({
              where: { userId: viewer.id, threadKind: "order", threadId: order.id },
              select: { id: true },
            });
            return !seen;
          })()) && (
            <p
              className="muted-text"
              style={{ marginTop: 28, marginBottom: -8, fontSize: 13 }}
            >
              Message the supplier about this order using the thread below.
              Replies arrive by email too.
            </p>
          )}
          <div className="card" id="messages" style={{ marginTop: 28 }}>
            <div className="card-head">
              <h2>Conversation{visibleMessages.length > 0 ? ` · ${visibleMessages.length}` : ""}</h2>
            </div>
            <div className="card-body">
              <MessageThread
                orderId={order.id}
                canPost={canMessage}
                viewerRole={viewerThreadRole}
                messages={visibleMessages.map((m) => ({
                  id: m.id,
                  senderName: m.senderName,
                  senderRole: m.senderRole,
                  body: m.body,
                  createdAt: m.createdAt.toISOString(),
                  visibility: m.visibility,
                  attachments: m.attachments.map((a) => ({
                    id: a.id,
                    fileName: a.fileName,
                    fileSize: a.fileSize,
                    mimeType: a.mimeType,
                    blobUrl: a.blobUrl,
                  })),
                }))}
              />
            </div>
          </div>

          {canOpenReturn && (
            <div className="card" style={{ marginTop: 28 }}>
              <div className="card-head">
                <h2>Issues with this order</h2>
              </div>
              <div className="card-body">
                {order.returns.length > 0 ? (
                  <ul className="return-list">
                    {order.returns.map((r) => (
                      <li key={r.id} className="return-item">
                        <div className="invoice-meta-label">
                          {r.reference} · {r.status}
                        </div>
                        <div style={{ fontWeight: 600, marginTop: 4 }}>
                          {r.reason}
                        </div>
                        {r.details && (
                          <p className="muted-text" style={{ fontSize: 13, marginTop: 4 }}>
                            {r.details}
                          </p>
                        )}
                        {r.adminNote && (
                          <p className="muted-text" style={{ fontSize: 13, marginTop: 4 }}>
                            <strong style={{ color: "var(--ink)" }}>PartsPort:</strong>{" "}
                            {r.adminNote}
                          </p>
                        )}
                        <div className="muted-text" style={{ fontSize: 12, marginTop: 4 }}>
                          Opened {r.createdAt.toLocaleDateString()}
                          {r.resolvedAt
                            ? ` · resolved ${r.resolvedAt.toLocaleDateString()}`
                            : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-text" style={{ fontSize: 13.5, marginBottom: 14 }}>
                    Inspect the shipment on arrival and note any damage on the
                    carrier delivery receipt. If something is wrong, file a
                    return request below within the claim window in the
                    supplier agreement.
                  </p>
                )}
                <div style={{ marginTop: 12 }}>
                  <ReturnRequestForm
                    orderId={order.id}
                    deliveredAt={order.deliveredAt ? order.deliveredAt.toISOString() : null}
                  />
                </div>
              </div>
            </div>
          )}

          {isBuyer && order.status === "FULFILLED" && (
            <div className="card" style={{ marginTop: 28 }}>
              <div className="card-head">
                <h2>Leave reviews</h2>
                <span className="muted-text" style={{ fontSize: 12.5 }}>
                  Help other buyers. Your name shows as &ldquo;Firstname L.&rdquo;
                </span>
              </div>
              <div className="card-body">
                {(() => {
                  const seen = new Set<string>();
                  const reviewedSet = new Set(
                    order.reviews.map((r) => r.productId)
                  );
                  const uniqueItems = order.items.filter((it) => {
                    if (seen.has(it.productId)) return false;
                    seen.add(it.productId);
                    return true;
                  });
                  return uniqueItems.map((it) => {
                    const alreadyReviewed = reviewedSet.has(it.productId);
                    return (
                      <div key={it.productId} className="review-on-order">
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                            flexWrap: "wrap",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14.5 }}>
                              {it.nameSnapshot}
                            </div>
                            <div
                              className="muted-text"
                              style={{ fontSize: 12 }}
                            >
                              {it.skuSnapshot} &middot;{" "}
                              {it.product.supplier.name}
                            </div>
                          </div>
                          {alreadyReviewed && (
                            <span className="verified-badge">
                              Reviewed
                            </span>
                          )}
                        </div>
                        {!alreadyReviewed && (
                          <div style={{ marginTop: 12 }}>
                            <WriteReview
                              productId={it.productId}
                              orderId={order.id}
                              compact
                            />
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

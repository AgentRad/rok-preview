import "server-only";
import crypto from "node:crypto";
import { Resend } from "resend";
import { prisma } from "./db";
import { siteUrl } from "./site-url";
import { signOrderViewToken } from "./order-link";
import { trackingLink } from "./tracking";
import { formatCents } from "./money";
import { replyAddress, type ThreadKind } from "./inbound-email";
import { captureError } from "./observability";

/**
 * PLH-3c F0: for guest orders (buyerId == null) the outbound email
 * deep-link must carry a signed token so the recipient can view the
 * order without a session. Logged-in buyer flows keep the bare URL.
 */
function orderViewUrl(
  order: { id: string; buyerId?: string | null; buyerEmail: string },
  suffix = ""
): string {
  const base = `/orders/${order.id}${suffix}`;
  if (order.buyerId) return siteUrl(base);
  const token = signOrderViewToken(order.id, order.buyerEmail);
  const sep = base.includes("?") ? "&" : "?";
  return siteUrl(`${base}${sep}t=${token}`);
}

/**
 * PLH-2 Phase 4d (D1): email categorization.
 *
 * TRANSACTIONAL (no opt-out, CAN-SPAM safe-harbor): these always send,
 * regardless of any user notification flag.
 *   sendOrderConfirmation, sendPaymentReceived, sendOrderShipped,
 *   sendOrderRefunded, sendOrderDelivered, sendRfqReceived, sendQuoteReady,
 *   sendQuoteDeclined, sendApplicationStatus, sendThreadMessage,
 *   sendNewSupplierWelcome, sendSupplierInvite, sendEmailVerification,
 *   sendEmailChangeNotice, sendEmailChangeConfirm,
 *   sendAccountDeletionScheduled, sendReturnApproved, sendReturnRejected,
 *   sendReturnResolved, sendReturnNotifySupplier, sendPasswordReset,
 *   sendSupplierDocReviewed, sendTwoFactorDisabled,
 *   sendAddressAlreadyRegistered, sendDeletedAccountSignInAttempt
 *
 * NON-TRANSACTIONAL (gated by User.notifyMarketingEmails /
 * notifyProductUpdates / notifyOrderEmails flags): broadcasts, product
 * announcements, optional digests. Wrap with shouldSendToUser().
 */

export type EmailCategory = "order" | "marketing" | "product";

/**
 * Returns false when the user has opted out of this non-transactional
 * category. Returns true on unknown user (so guest broadcasts still send
 * when they were authorized in the first place). Never gates
 * transactional mail; callers are required to use this only for
 * non-essential categories per the legend above.
 */
export async function shouldSendToUser(
  userId: string | null | undefined,
  category: EmailCategory
): Promise<boolean> {
  if (!userId) return true;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        notifyOrderEmails: true,
        notifyMarketingEmails: true,
        notifyProductUpdates: true,
      },
    });
    if (!user) return true;
    if (category === "order") return user.notifyOrderEmails;
    if (category === "marketing") return user.notifyMarketingEmails;
    if (category === "product") return user.notifyProductUpdates;
    return true;
  } catch (err) {
    captureError(err, { subsystem: "email-prefs", category });
    // Fail-open on the read so a DB hiccup never silently swallows mail.
    return true;
  }
}

/**
 * PLH-2 Phase 4d (D1): signed one-click unsubscribe token. Embedded in
 * the List-Unsubscribe header and on a public /api/email/unsubscribe
 * endpoint so the recipient can opt out without logging in.
 */
function unsubSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.INBOUND_REPLY_SECRET ||
    "partsport-unsub-fallback"
  );
}

export function signUnsubscribeToken(userId: string): string {
  const sig = crypto
    .createHmac("sha256", unsubSecret())
    .update(userId)
    .digest("hex")
    .slice(0, 24);
  return `${userId}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [userId, sig] = parts;
  if (!userId || !sig) return null;
  const expected = crypto
    .createHmac("sha256", unsubSecret())
    .update(userId)
    .digest("hex")
    .slice(0, 24);
  if (expected.length !== sig.length) return null;
  try {
    if (
      !crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8"))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return userId;
}

function unsubscribeHeaders(toEmail: string): Record<string, string> {
  // Mailto unsubscribe + one-click POST URL. The token is per-recipient
  // when we know the userId; otherwise we fall back to a mailto-only
  // header so the recipient can still reply to opt out.
  const mailto = `mailto:unsubscribe@partsport.agentgaming.gg?subject=unsubscribe%20${encodeURIComponent(toEmail)}`;
  return {
    "List-Unsubscribe": `<${mailto}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

function unsubscribeHeadersForUser(userId: string, toEmail: string): Record<string, string> {
  const token = signUnsubscribeToken(userId);
  const oneClick = siteUrl(`/api/email/unsubscribe?token=${encodeURIComponent(token)}`);
  const mailto = `mailto:unsubscribe@partsport.agentgaming.gg?subject=unsubscribe%20${encodeURIComponent(toEmail)}`;
  return {
    "List-Unsubscribe": `<${oneClick}>, <${mailto}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// PLH-1 commit 2: HTML-escape any user-supplied string we drop into an
// email body. Subject lines (plain text) stay alone. The map covers the
// five chars that change HTML structure or break out of attribute strings.
function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]!));
}

type SendArgs = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

const FROM_DEFAULT = "PartsPort <orders@partsport.agentgaming.gg>";
const FROM_AUTH = "PartsPort <noreply@partsport.agentgaming.gg>";

let _client: Resend | null = null;
function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_client) _client = new Resend(key);
  return _client;
}

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

async function send(
  args: SendArgs & { from?: string; userId?: string | null }
): Promise<{ ok: boolean }> {
  const c = client();
  if (!c) return { ok: false };
  try {
    // PLH-2 Phase 4d (D1): RFC 8058 List-Unsubscribe. When we know the
    // user, the One-Click URL flips their marketing flag without login.
    // For sends with no user (e.g. supplier application updates to a
    // not-yet-a-user contact), we still set a mailto unsubscribe so we
    // are CAN-SPAM compliant.
    const toFirst = Array.isArray(args.to) ? args.to[0] : args.to;
    const unsubHdrs = args.userId
      ? unsubscribeHeadersForUser(args.userId, toFirst)
      : unsubscribeHeaders(toFirst);
    await c.emails.send({
      from: args.from || FROM_DEFAULT,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      replyTo: args.replyTo,
      headers: unsubHdrs,
    });
    return { ok: true };
  } catch (err) {
    captureError(err, { subsystem: "email", subject: args.subject });
    return { ok: false };
  }
}

function wrap(title: string, body: string, footerHint?: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f2ef;font-family:'Hanken Grotesk',-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1916;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f2ef;padding:36px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="background:#ffffff;border:1px solid #e2e0d9;border-radius:5px;">
            <tr>
              <td style="padding:28px 32px;border-bottom:1px solid #1a1916;">
                <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9b988d;">PartsPort</div>
                <div style="font-size:21px;font-weight:600;letter-spacing:-.02em;margin-top:4px;">${title}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px;font-size:14.5px;line-height:1.6;color:#1a1916;">
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f3f2ef;border-top:1px solid #e2e0d9;font-size:12px;color:#6f6d64;line-height:1.5;">
                ${
                  footerHint ||
                  "PartsPort, the industrial parts marketplace. Questions: support@partsport.agentgaming.gg."
                }
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function btn(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#1a1916;color:#f3f2ef;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:500;font-size:14px;">${label}</a>`;
}

type OrderLite = {
  id: string;
  reference: string;
  buyerId?: string | null;
  buyerName: string;
  buyerEmail: string;
  buyerCompanyName?: string | null;
  buyerCompanyLogoUrl?: string | null;
  totalCents: number;
  subtotalCents: number;
  freightCents: number;
  feeCents: number;
  taxCents: number;
  feeRateBps: number;
  shipTo: string;
  carrier?: string | null;
  trackingCode?: string | null;
  // P9.5 MED 23: surface freight detail in the order confirmation +
  // shipped + delivered + refund emails so AP teams can reconcile.
  freightCarrier?: string | null;
  freightService?: string | null;
  freightSurcharges?: unknown;
  // PLH-3v: enterprise PO number, surfaced in the order confirmation
  // subject suffix when set so AP teams can match the email to a PO
  // without opening it.
  purchaseOrderNumber?: string | null;
  // PLH-3z-1: net-terms invoice. When the order is billed on net terms these
  // carry the terms label and due date for the invoice-issued email.
  paymentTerms?: string | null;
  invoiceDueDate?: Date | string | null;
  items: {
    nameSnapshot: string;
    skuSnapshot: string;
    qty: number;
    supplierName: string;
    unitPriceCents?: number;
    product?: { supplierId?: string | null } | null;
  }[];
  // PLH-3g P7: per-supplier slot data for multi-supplier orders. When
  // length > 1, order emails switch to a per-supplier breakdown view.
  // Single-supplier orders pass an empty/length-1 slots list and the
  // existing one-block layout is used.
  supplierSlots?: {
    id: string;
    supplierId: string;
    supplierName?: string | null;
    subtotalCents: number;
    freightCents: number;
    feeCents: number;
    carrier?: string | null;
    trackingCode?: string | null;
    trackingUrl?: string | null;
    shipmentStage?: string | null;
    shippedAt?: Date | null;
    deliveredAt?: Date | null;
  }[];
};

// P9.5 MED 23: freight detail in the totals block. Pulls carrier/service
// label and surcharge breakdown when present.
function freightDetail(order: OrderLite): string {
  const parts: string[] = [];
  if (order.freightCarrier) {
    parts.push(
      `${order.freightCarrier}${order.freightService ? " " + order.freightService : ""}`
    );
  }
  if (order.freightSurcharges && typeof order.freightSurcharges === "object") {
    const s = order.freightSurcharges as {
      liftgate?: boolean;
      residential?: boolean;
      insideDelivery?: boolean;
    };
    const sub: string[] = [];
    if (s.liftgate) sub.push("liftgate +$150");
    if (s.residential) sub.push("residential +$75");
    if (s.insideDelivery) sub.push("inside delivery +$200");
    if (sub.length > 0) parts.push(`includes ${sub.join(", ")}`);
  }
  if (parts.length === 0) return "";
  return `<div style="font-size:11px;color:#6f6d64;margin-top:2px;">${parts.join(" · ")}</div>`;
}

/**
 * Render the buyer's company logo + name above the order summary block in
 * emails when the order has one snapshotted. Inline-styled so it survives
 * email-client CSS stripping. Renders nothing when missing.
 */
function buyerBranding(order: OrderLite): string {
  if (!order.buyerCompanyName && !order.buyerCompanyLogoUrl) return "";
  const logo = order.buyerCompanyLogoUrl
    ? `<img src="${order.buyerCompanyLogoUrl}" alt="" width="56" height="56" style="border:1px solid #e2e0d9;border-radius:4px;padding:4px;background:#fff;object-fit:contain;vertical-align:middle;margin-right:10px;" />`
    : "";
  const name = order.buyerCompanyName
    ? `<span style="font-weight:600;font-size:14px;color:#1a1916;">${esc(order.buyerCompanyName)}</span>`
    : "";
  return `<div style="margin:14px 0 6px;display:flex;align-items:center;">${logo}${name}</div>`;
}

function feeLabel(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

function lineRows(order: OrderLite): string {
  return order.items
    .map(
      (it) =>
        `<tr><td style="padding:6px 0;font-size:13px;">${esc(it.nameSnapshot)} <span style="color:#9b988d;">(${esc(it.skuSnapshot)})</span></td><td style="padding:6px 0;font-size:13px;text-align:right;">× ${it.qty}</td></tr>`
    )
    .join("");
}

function totals(order: OrderLite): string {
  const fd = freightDetail(order);
  return `
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-top:12px;border-top:1px solid #e2e0d9;">
      <tr><td style="padding:6px 0;font-size:13px;">Subtotal</td><td style="padding:6px 0;font-size:13px;text-align:right;">${formatCents(order.subtotalCents)}</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;">Freight${fd}</td><td style="padding:6px 0;font-size:13px;text-align:right;vertical-align:top;">${formatCents(order.freightCents)}</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;">Platform fee (${feeLabel(order.feeRateBps)})</td><td style="padding:6px 0;font-size:13px;text-align:right;">${formatCents(order.feeCents)}</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;">Sales tax</td><td style="padding:6px 0;font-size:13px;text-align:right;">${formatCents(order.taxCents)}</td></tr>
      <tr><td style="padding:8px 0 0;font-size:14px;font-weight:700;border-top:1px solid #1a1916;">Total</td><td style="padding:8px 0 0;font-size:14px;font-weight:700;text-align:right;border-top:1px solid #1a1916;">${formatCents(order.totalCents)}</td></tr>
    </table>`;
}

// PLH-3g P7: multi-supplier helpers. When an order has > 1 slot the
// buyer wants to see what's coming from whom; the templates switch to
// per-supplier sections that mirror the on-site order page.
function isMultiSupplier(order: OrderLite): boolean {
  return (order.supplierSlots?.length ?? 0) > 1;
}

function itemsForSlot(
  order: OrderLite,
  supplierId: string
): OrderLite["items"] {
  return order.items.filter((it) => it.product?.supplierId === supplierId);
}

function slotBlock(
  order: OrderLite,
  slot: NonNullable<OrderLite["supplierSlots"]>[number],
  opts: { showTracking?: boolean } = {}
): string {
  const items = itemsForSlot(order, slot.supplierId);
  const rows = items
    .map(
      (it) =>
        `<tr><td style="padding:6px 0;font-size:13px;">${esc(it.nameSnapshot)} <span style="color:#9b988d;">(${esc(it.skuSnapshot)})</span></td><td style="padding:6px 0;font-size:13px;text-align:right;">&times; ${it.qty}</td></tr>`
    )
    .join("");
  const trackLink = slot.trackingUrl
    ? slot.trackingUrl
    : trackingLink(slot.carrier ?? null, slot.trackingCode ?? null);
  const stageLabel = esc(slot.shipmentStage || "Pending");
  const tracking =
    opts.showTracking && slot.shippedAt && slot.carrier
      ? `<div style="margin:10px 0 0;padding:10px 12px;background:#ffffff;border:1px solid #e2e0d9;border-radius:3px;">
           <div style="font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#6f6d64;">Tracking</div>
           <div style="font-weight:700;font-size:13px;margin-top:2px;">${esc(slot.carrier)}</div>
           <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#6f6d64;">${esc(slot.trackingCode ?? "")}</div>
           ${trackLink ? `<div style="margin-top:6px;"><a href="${trackLink}" style="color:#1a1916;font-weight:600;text-decoration:underline;font-size:12.5px;">Track with the carrier</a></div>` : ""}
         </div>`
      : "";
  return `
    <div style="margin:14px 0;padding:14px 16px;background:#f3f2ef;border-left:3px solid #1a1916;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;">
        <div style="font-weight:700;font-size:14px;">${esc(slot.supplierName || "Supplier")}</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#6f6d64;">${stageLabel}</div>
      </div>
      <table cellpadding="0" cellspacing="0" width="100%" style="margin-top:8px;">${rows}</table>
      <table cellpadding="0" cellspacing="0" width="100%" style="margin-top:8px;border-top:1px solid #e2e0d9;">
        <tr><td style="padding:5px 0;font-size:12.5px;color:#6f6d64;">Subtotal</td><td style="padding:5px 0;font-size:12.5px;text-align:right;">${formatCents(slot.subtotalCents)}</td></tr>
        <tr><td style="padding:5px 0;font-size:12.5px;color:#6f6d64;">Freight</td><td style="padding:5px 0;font-size:12.5px;text-align:right;">${formatCents(slot.freightCents)}</td></tr>
      </table>
      ${tracking}
    </div>`;
}

function perSupplierSections(
  order: OrderLite,
  opts: { showTracking?: boolean } = {}
): string {
  if (!order.supplierSlots || order.supplierSlots.length === 0) return "";
  return order.supplierSlots.map((s) => slotBlock(order, s, opts)).join("");
}

export async function sendOrderConfirmation(order: OrderLite): Promise<void> {
  const url = orderViewUrl(order);
  const multi = isMultiSupplier(order);
  const lead = multi
    ? `<p>We have received your order <strong>${esc(order.reference)}</strong>. Payment is the next step. Your order ships from ${order.supplierSlots!.length} suppliers; each section below tracks separately.</p>`
    : `<p>We have received your order <strong>${esc(order.reference)}</strong>. Payment is the next step. Once received, the supplier will begin preparing your parts.</p>`;
  const itemsBlock = multi
    ? perSupplierSections(order)
    : `<table cellpadding="0" cellspacing="0" width="100%" style="margin:12px 0;">${lineRows(order)}</table>`;
  const body = `
    <p>Hi ${esc(order.buyerName)},</p>
    ${lead}
    ${buyerBranding(order)}
    ${itemsBlock}
    ${totals(order)}
    <p style="margin-top:22px;">${btn(url, "View order")}</p>`;
  const poSuffix = order.purchaseOrderNumber ? ` [PO ${order.purchaseOrderNumber}]` : "";
  await send({
    to: order.buyerEmail,
    subject: `Order ${order.reference} received${poSuffix}`,
    html: wrap("Order received", body),
  });
}

export async function sendPaymentReceived(order: OrderLite): Promise<void> {
  const url = orderViewUrl(order);
  const invoiceUrl = orderViewUrl(order, "/invoice");
  const body = `
    <p>Hi ${esc(order.buyerName)},</p>
    <p>Thank you. Payment for order <strong>${esc(order.reference)}</strong> has been received and the supplier has been notified. We will keep you posted as it moves through fulfillment.</p>
    ${buyerBranding(order)}
    ${totals(order)}
    <p style="margin-top:22px;">${btn(url, "Track order")} &nbsp; <a href="${invoiceUrl}" style="color:#1a1916;font-weight:600;text-decoration:underline;">View invoice</a></p>`;
  await send({
    to: order.buyerEmail,
    subject: `Payment received for order ${order.reference}`,
    html: wrap("Payment received", body),
  });
}

/**
 * PLH-3z-1: net-terms invoice issued. Sent at order-create time for an invoice
 * order (no Stripe Checkout). States the terms, the amount due, and the due
 * date, and links to the hosted invoice. We link to the invoice page rather
 * than attaching a PDF (no PDF renderer in the tree); the page is the system
 * of record and AP teams can print it from there.
 */
export async function sendInvoiceIssued(order: OrderLite): Promise<void> {
  const invoiceUrl = orderViewUrl(order, "/invoice");
  const termsLabel = (order.paymentTerms ?? "NET_30").replace("NET_", "Net ");
  const due = order.invoiceDueDate ? new Date(order.invoiceDueDate) : null;
  const dueStr = due
    ? due.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "the date on the invoice";
  const poLine = order.purchaseOrderNumber
    ? `<p style="margin:4px 0;color:#555;">PO #: ${esc(order.purchaseOrderNumber)}</p>`
    : "";
  const body = `
    <p>Hi ${esc(order.buyerName)},</p>
    <p>Invoice for order <strong>${esc(order.reference)}</strong> has been issued on <strong>${esc(termsLabel)}</strong> terms. Payment is due by <strong>${esc(dueStr)}</strong>.</p>
    ${poLine}
    ${buyerBranding(order)}
    ${totals(order)}
    <p style="margin-top:22px;">${btn(invoiceUrl, "View invoice")}</p>`;
  await send({
    to: order.buyerEmail,
    subject: `Invoice for order ${order.reference} (${termsLabel}, due ${dueStr})`,
    html: wrap("Invoice issued", body),
  });
}

/**
 * PLH-3g P7: per-supplier ship notifications.
 *
 * When `slotSupplierId` is provided, the email is scoped to that single
 * supplier's portion of the order: only that slot's items, tracking, and
 * a summary of what's still pending from other suppliers. Fires once per
 * slot dispatch in `markSlotShipped` so a buyer with a multi-supplier
 * order gets one ship email per supplier as their pieces dispatch.
 *
 * When `slotSupplierId` is omitted, the email is the legacy aggregate
 * "your order has shipped" notice. Single-supplier orders use this
 * unchanged. Multi-supplier orders also fire this once at the LAST slot
 * dispatch as a roll-up confirming the full order is on the way.
 */
export async function sendOrderShipped(
  order: OrderLite,
  opts: { slotSupplierId?: string } = {}
): Promise<void> {
  const url = orderViewUrl(order);
  const multi = isMultiSupplier(order);

  if (opts.slotSupplierId && multi && order.supplierSlots) {
    const slot = order.supplierSlots.find(
      (s) => s.supplierId === opts.slotSupplierId
    );
    if (!slot) return;
    const otherSlots = order.supplierSlots.filter(
      (s) => s.supplierId !== opts.slotSupplierId
    );
    const remaining = otherSlots.filter(
      (s) => s.shipmentStage !== "Shipped" && s.shipmentStage !== "Delivered"
    );
    const remainingBlock =
      remaining.length > 0
        ? `<p style="font-size:13px;color:#6f6d64;">Still pending from ${remaining
            .map((s) => esc(s.supplierName || "another supplier"))
            .join(", ")}. Those will get their own tracking when dispatched.</p>`
        : `<p style="font-size:13px;color:#6f6d64;">All suppliers on this order have now dispatched.</p>`;
    const supplierName = esc(slot.supplierName || "Your supplier");
    const body = `
      <p>Hi ${esc(order.buyerName)},</p>
      <p>${supplierName} has dispatched their portion of order <strong>${esc(order.reference)}</strong>.</p>
      ${buyerBranding(order)}
      ${slotBlock(order, slot, { showTracking: true })}
      ${remainingBlock}
      <p>For LTL freight, please inspect the shipment on arrival and note any damage on the carrier delivery receipt before signing.</p>
      <p style="margin-top:22px;">${btn(url, "View order")}</p>`;
    await send({
      to: order.buyerEmail,
      subject: `${slot.supplierName || "Supplier"} shipped part of order ${order.reference}`,
      html: wrap("A shipment is on the way", body),
    });
    return;
  }

  const link = trackingLink(order.carrier, order.trackingCode);
  const trackBlock = !multi && order.carrier
    ? `<div style="margin:14px 0;padding:14px 16px;background:#f3f2ef;border-left:3px solid #1a1916;">
         <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6f6d64;">Tracking</div>
         <div style="font-weight:700;margin-top:4px;">${esc(order.carrier)}</div>
         <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#6f6d64;">${esc(order.trackingCode ?? "")}</div>
         ${link ? `<div style="margin-top:10px;"><a href="${link}" style="color:#1a1916;font-weight:600;text-decoration:underline;">Track with the carrier</a></div>` : ""}
       </div>`
    : "";
  const multiBlock = multi
    ? perSupplierSections(order, { showTracking: true })
    : "";
  const headline = multi
    ? `<p>Every supplier on your order <strong>${esc(order.reference)}</strong> has now dispatched. The full breakdown is below.</p>`
    : `<p>Your order <strong>${esc(order.reference)}</strong> has shipped.</p>`;
  const body = `
    <p>Hi ${esc(order.buyerName)},</p>
    ${headline}
    ${buyerBranding(order)}
    ${trackBlock}
    ${multiBlock}
    <p>For LTL freight, please inspect the shipment on arrival and note any damage on the carrier delivery receipt before signing.</p>
    <p style="margin-top:22px;">${btn(url, "View order")}</p>`;
  await send({
    to: order.buyerEmail,
    subject: `Your PartsPort order ${order.reference} has shipped`,
    html: wrap("Your order is on the way", body),
  });
}

/**
 * P9.5 HIGH 14: dedicated refund notification. Pre-fix the refund route
 * reused sendOrderConfirmation which told the buyer "Thanks for your
 * order" after a refund. This version names the refund explicitly and
 * surfaces the amount + reason so the buyer can match it against their
 * card statement.
 */
export async function sendOrderRefunded(
  order: OrderLite,
  refundedCents: number,
  reason: string,
  scopeSupplierName?: string | null
): Promise<void> {
  const url = orderViewUrl(order);
  const isFull = refundedCents >= order.totalCents;
  const supplierScope = scopeSupplierName && isMultiSupplier(order);
  const headline = supplierScope
    ? `<p>${esc(scopeSupplierName!)}'s portion of order <strong>${esc(order.reference)}</strong> has been refunded: <strong>${formatCents(refundedCents)}</strong>.</p>`
    : `<p>${isFull ? "A full refund" : `A partial refund of <strong>${formatCents(refundedCents)}</strong>`} has been issued for order <strong>${esc(order.reference)}</strong>.</p>`;
  const body = `
    <p>Hi ${esc(order.buyerName)},</p>
    ${headline}
    ${reason ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;"><strong>Reason:</strong> ${esc(reason)}</p>` : ""}
    <p>Funds will reach your card or bank in 5 to 10 business days, depending on your issuer. The refund will appear as a credit on the statement that includes the original PartsPort charge.</p>
    ${buyerBranding(order)}
    <p style="margin-top:22px;">${btn(url, "View order")}</p>`;
  await send({
    to: order.buyerEmail,
    subject: `Refund issued for order ${order.reference}`,
    html: wrap(isFull ? "Refund issued" : "Partial refund issued", body),
  });
}

export async function sendOrderDelivered(order: OrderLite): Promise<void> {
  const url = orderViewUrl(order);
  const multi = isMultiSupplier(order);
  const perSupplier = multi
    ? perSupplierSections(order, { showTracking: false })
    : "";
  const body = `
    <p>Hi ${esc(order.buyerName)},</p>
    <p>Order <strong>${esc(order.reference)}</strong> has been marked delivered${multi ? " (every supplier on the order has now delivered)" : ""}. If anything is missing or damaged, please report it within the claim window in the supplier agreement.</p>
    ${perSupplier}
    <p style="margin-top:22px;">${btn(url, "View order")}</p>`;
  await send({
    to: order.buyerEmail,
    subject: `Order ${order.reference} delivered`,
    html: wrap("Order delivered", body),
  });
}

type QuoteLite = {
  id: string;
  reference: string;
  buyerName: string;
  buyerEmail: string;
  qty: number;
  message: string;
  productName: string;
  productSku: string;
  supplierName: string;
  supplierEmail?: string | null;
  quotedUnitCents?: number | null;
  quoteNote?: string | null;
};

export async function sendRfqReceived(quote: QuoteLite): Promise<void> {
  const url = siteUrl(`/quotes/${quote.id}`);
  const reply = replyAddress("quote", quote.id);
  const body = `
    <p>Hi ${esc(quote.buyerName)},</p>
    <p>We have received your request for a quote on <strong>${esc(quote.productName)}</strong> (SKU ${esc(quote.productSku)}, qty ${quote.qty}). A vetted supplier is preparing a price. You will see the quote at the link below, typically within one business day.</p>
    <p style="margin-top:22px;">${btn(url, "View RFQ")}</p>`;
  await send({
    to: quote.buyerEmail,
    subject: `RFQ ${quote.reference} received`,
    html: wrap("RFQ received", body),
    replyTo: reply || undefined,
  });

  if (quote.supplierEmail) {
    const supplierUrl = siteUrl(`/supplier`);
    const supplierBody = `
      <p>A new RFQ has landed for <strong>${esc(quote.productName)}</strong> (SKU ${esc(quote.productSku)}, qty ${quote.qty}) from ${esc(quote.buyerName)}.</p>
      ${quote.message ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;">${esc(quote.message)}</p>` : ""}
      <p>Please respond with a price and lead time as soon as possible. Buyer experience depends on quote speed.</p>
      <p style="margin-top:22px;">${btn(supplierUrl, "Open supplier dashboard")}</p>`;
    await send({
      to: quote.supplierEmail,
      subject: `New RFQ ${quote.reference}: ${quote.productName}`,
      html: wrap("New RFQ to quote", supplierBody),
      replyTo: reply || undefined,
    });
  }
}

export async function sendQuoteReady(quote: QuoteLite): Promise<void> {
  const url = siteUrl(`/quotes/${quote.id}`);
  const priceBlock =
    quote.quotedUnitCents != null
      ? `<p>Unit price: <strong>${formatCents(quote.quotedUnitCents)}</strong> × ${quote.qty}</p>`
      : "";
  const noteBlock = quote.quoteNote
    ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;"><strong>Supplier note:</strong> ${esc(quote.quoteNote)}</p>`
    : "";
  const body = `
    <p>Hi ${esc(quote.buyerName)},</p>
    <p>${esc(quote.supplierName)} has responded to your RFQ <strong>${esc(quote.reference)}</strong> for ${esc(quote.productName)}.</p>
    ${priceBlock}
    ${noteBlock}
    <p style="margin-top:22px;">${btn(url, "Review the quote")}</p>`;
  await send({
    to: quote.buyerEmail,
    subject: `Quote ready for RFQ ${quote.reference}`,
    html: wrap("Your quote is ready", body),
  });
}

export async function sendApplicationStatus(args: {
  to: string;
  contactName: string;
  companyName: string;
  approved: boolean;
  tempPassword?: string | null;
}): Promise<void> {
  if (args.approved) {
    const url = siteUrl(`/login`);
    const credsBlock = args.tempPassword
      ? `<p>A temporary sign-in has been created. Please change your password after the first sign-in.</p>
         <p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:13px;">
           <strong>Email:</strong> ${esc(args.to)}<br><strong>Temporary password:</strong> ${esc(args.tempPassword)}
         </p>`
      : "<p>Use your existing PartsPort account to sign in.</p>";
    const body = `
      <p>Hi ${esc(args.contactName)},</p>
      <p>Your application for <strong>${esc(args.companyName)}</strong> has been approved. Welcome to PartsPort.</p>
      ${credsBlock}
      <p style="margin-top:22px;">${btn(url, "Sign in")}</p>`;
    await send({
      to: args.to,
      subject: `${args.companyName} approved on PartsPort`,
      html: wrap("Application approved", body),
    });
  } else {
    const body = `
      <p>Hi ${esc(args.contactName)},</p>
      <p>Thank you for your interest. After review, we are not able to onboard <strong>${esc(args.companyName)}</strong> at this time. You can reach out at support@partsport.agentgaming.gg if you would like more detail.</p>`;
    await send({
      to: args.to,
      subject: `Update on your PartsPort application`,
      html: wrap("Application update", body),
    });
  }
}

// PLH-3z-3: net-terms credit application decisions.
export async function sendCreditApplicationApproved(args: {
  to: string;
  contactName: string;
  orgName: string;
  termsLabel: string;
  limitDollars: string;
}): Promise<void> {
  const url = siteUrl(`/buyer-org`);
  const body = `
    <p>Hi ${esc(args.contactName)},</p>
    <p>Your net-terms application for <strong>${esc(args.orgName)}</strong> has been approved. Your organization is now set up for <strong>${esc(args.termsLabel)}</strong> billing with a credit limit of <strong>$${esc(args.limitDollars)}</strong>.</p>
    <p>Orders placed by your members will be billed by invoice with the due date shown on each invoice.</p>
    <p style="margin-top:22px;">${btn(url, "View your organization")}</p>`;
  await send({
    to: args.to,
    subject: `${args.orgName} approved for ${args.termsLabel} terms on PartsPort`,
    html: wrap("Net terms approved", body),
  });
}

export async function sendCreditApplicationRejected(args: {
  to: string;
  contactName: string;
  orgName: string;
  reason: string;
}): Promise<void> {
  const reasonBlock = args.reason
    ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;">${esc(args.reason)}</p>`
    : "";
  const body = `
    <p>Hi ${esc(args.contactName)},</p>
    <p>Thank you for your net-terms application for <strong>${esc(args.orgName)}</strong>. After review, we are not able to approve net terms at this time.</p>
    ${reasonBlock}
    <p>You can continue to place orders with prepaid checkout, and you are welcome to submit a new application. Reach out at support@partsport.agentgaming.gg with any questions.</p>`;
  await send({
    to: args.to,
    subject: `Update on your PartsPort net-terms application`,
    html: wrap("Net terms application update", body),
  });
}

/**
 * PLH-3o: thread emails render as a normal one-on-one conversation, not
 * a branded card. Plain paragraphs for the sender's text, a quoted block
 * for the most recent prior message in standard "On <Date> at <Time>,
 * <Name> <email> wrote:" style, and a tiny gray "Open thread" link at
 * the bottom. Gmail collapses its own thread history under "..." so we
 * only send the single most recent prior message; the full DB thread
 * does not need to ride along.
 */
export async function sendThreadMessage(args: {
  to: string;
  senderName: string;
  subjectPrefix: string; // "Order PP-ABC123" or "RFQ RFQ-ABC123"
  body: string;
  threadUrl: string;
  threadKind: ThreadKind;
  threadId: string;
  recipientUserId?: string | null;
  prevMessage?: {
    senderName: string;
    senderEmail: string;
    body: string;
    createdAt: Date;
  } | null;
  // PLH-3p F2: count of files attached to this Message. We never include the
  // bytes in the outbound email (size + spam reasons); instead a single
  // muted line points the recipient back to the thread URL.
  attachmentCount?: number;
}): Promise<void> {
  if (args.recipientUserId) {
    const ok = await shouldSendToUser(args.recipientUserId, "order");
    if (!ok) return;
  }

  const paragraphs = (text: string, style = "margin:0 0 12px;"): string =>
    text
      .split("\n")
      .map((line) => `<p style="${style}">${line ? esc(line) : "&nbsp;"}</p>`)
      .join("");

  let quotedHtml = "";
  let quotedText = "";
  if (args.prevMessage) {
    const when = args.prevMessage.createdAt;
    const dateStr = when.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const timeStr = when.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    const attribution = `On ${dateStr} at ${timeStr}, ${args.prevMessage.senderName} <${args.prevMessage.senderEmail}> wrote:`;
    quotedHtml = `
      <div style="color:#6f6d64;font-size:13px;margin:20px 0 8px;">${esc(attribution)}</div>
      <blockquote style="border-left:3px solid #ccc;padding-left:12px;margin:0;color:#6f6d64;">${paragraphs(args.prevMessage.body, "margin:0 0 10px;")}</blockquote>`;
    const quotedLines = args.prevMessage.body
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n");
    quotedText = `\n\n${attribution}\n${quotedLines}`;
  }

  const reply = replyAddress(args.threadKind, args.threadId);

  // Unsubscribe link: signed-token route when we know the user, mailto
  // fallback otherwise. CAN-SPAM footer requirement.
  const unsubUrl = args.recipientUserId
    ? siteUrl(
        `/api/email/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(args.recipientUserId))}`
      )
    : `mailto:unsubscribe@partsport.agentgaming.gg?subject=unsubscribe%20${encodeURIComponent(args.to)}`;

  const attachmentCount = args.attachmentCount ?? 0;
  const attachmentNoun = attachmentCount === 1 ? "attachment" : "attachments";
  const attachmentHtml =
    attachmentCount > 0
      ? `<p style="margin:16px 0 0;font-size:13px;color:#6f6d64;">📎 ${attachmentCount} ${attachmentNoun} - <a href="${args.threadUrl}" style="color:#6f6d64;">view in PartsPort</a></p>`
      : "";
  const attachmentText =
    attachmentCount > 0
      ? `\n\n📎 ${attachmentCount} ${attachmentNoun} - view in PartsPort: ${args.threadUrl}`
      : "";

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:20px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a1916;">
    ${paragraphs(args.body)}
    ${attachmentHtml}
    ${quotedHtml}
    <p style="margin:28px 0 4px;font-size:12px;color:#9b988d;">
      <a href="${args.threadUrl}" style="color:#9b988d;text-decoration:none;">Open thread on PartsPort &rarr;</a>
    </p>
    <p style="margin:0;font-size:11px;color:#c4c2b9;">
      <a href="${unsubUrl}" style="color:#c4c2b9;text-decoration:underline;">Unsubscribe</a>
    </p>
  </body>
</html>`;

  const text = `${args.body}${attachmentText}${quotedText}\n\nOpen thread: ${args.threadUrl}`;

  await send({
    to: args.to,
    subject: `[${args.subjectPrefix}] Message from ${args.senderName}`,
    html,
    text,
    replyTo: reply || undefined,
    userId: args.recipientUserId,
  });
}

/**
 * PLH-1 commit 3: replaces the old tempPassword welcome. We never email a
 * password (and never write one we could email). Instead, we mint a single
 * password-reset token and let the new supplier set their own password.
 */
export async function sendNewSupplierWelcome(args: {
  to: string;
  name: string;
  setPasswordLink: string;
}): Promise<void> {
  const body = `
    <p>Hi ${esc(args.name)},</p>
    <p>Welcome to PartsPort. Your supplier account has been approved and is ready to go.</p>
    <p>Click below to set your password. Once you're in, you can list parts, manage stock and pricing, respond to RFQs, see incoming orders, and invite your team.</p>
    <p style="margin-top:22px;">${btn(args.setPasswordLink, "Set your password")}</p>
    <p style="font-size:12.5px;color:#6f6d64;margin-top:16px;">For your security, this link expires in 60 minutes. If it expires, use the Forgot password link on the sign-in page to request a new one.</p>`;
  await send({
    to: args.to,
    subject: "Welcome to PartsPort, set your password",
    html: wrap("Welcome to PartsPort", body),
    from: FROM_AUTH,
  });
}

export async function sendSupplierInvite(args: {
  to: string;
  inviterName: string;
  companyName: string;
  acceptUrl: string;
  expiresDays: number;
}): Promise<void> {
  const body = `
    <p>${esc(args.inviterName)} invited you to join ${esc(args.companyName)}'s PartsPort account.</p>
    <p>PartsPort is the marketplace where you sell parts, respond to quote requests, manage orders, and get paid on dispatch. The link below adds you to ${esc(args.companyName)}'s team within the next ${args.expiresDays} days.</p>
    <p style="margin-top:22px;">${btn(args.acceptUrl, "Accept invitation")}</p>
    <p style="font-size:12.5px;color:#6f6d64;margin-top:16px;">If you don't have an account yet, you'll be asked to create one in the same step.</p>`;
  await send({
    to: args.to,
    subject: `${args.inviterName} invited you to ${args.companyName} on PartsPort`,
    html: wrap("Team invitation", body),
    from: FROM_AUTH,
  });
}

// PLH-3y-1: buyer organization invite. Mirrors sendSupplierInvite. The
// accept link lives at /buyer-org-invite/<raw-token>.
export async function sendBuyerOrgInvite(args: {
  to: string;
  inviterName: string;
  orgName: string;
  acceptUrl: string;
  expiresDays: number;
}): Promise<void> {
  const body = `
    <p>${esc(args.inviterName)} added you to ${esc(args.orgName)} on PartsPort.</p>
    <p>PartsPort is the marketplace where your team sources energy and utilities equipment, compares vetted suppliers, and places orders under one organization. The link below joins you to ${esc(args.orgName)} within the next ${args.expiresDays} days.</p>
    <p style="margin-top:22px;">${btn(args.acceptUrl, "Join the organization")}</p>
    <p style="font-size:12.5px;color:#6f6d64;margin-top:16px;">If you don't have an account yet, you'll be asked to create one in the same step.</p>`;
  await send({
    to: args.to,
    subject: `${args.inviterName} added you to ${args.orgName} on PartsPort`,
    html: wrap("Organization invitation", body),
    from: FROM_AUTH,
  });
}

export async function sendEmailVerification(args: {
  to: string;
  name: string;
  verifyUrl: string;
  expiresHours: number;
}): Promise<void> {
  const body = `
    <p>Hi ${esc(args.name)},</p>
    <p>Confirm this email to finish setting up your PartsPort account. The link below works for the next ${args.expiresHours} hours.</p>
    <p style="margin-top:22px;">${btn(args.verifyUrl, "Verify email")}</p>
    <p style="font-size:12.5px;color:#6f6d64;margin-top:16px;">If you didn't create a PartsPort account, you can ignore this email and the address won't be added to anything.</p>
    <p style="font-size:12.5px;color:#6f6d64;margin-top:6px;">Or paste this link into your browser: ${args.verifyUrl}</p>`;
  await send({
    to: args.to,
    subject: "Verify your PartsPort email",
    html: wrap("Verify your email", body),
    from: FROM_AUTH,
  });
}

export async function sendEmailChangeNotice(args: {
  to: string;
  name: string;
  oldEmail: string;
  newEmail: string;
}): Promise<void> {
  const body = `
    <p>Hi ${esc(args.name)},</p>
    <p>The email on your PartsPort account was changed from <strong>${esc(args.oldEmail)}</strong> to <strong>${esc(args.newEmail)}</strong>. From now on, sign-ins and notifications use the new address.</p>
    <p>If you didn't make this change, email <a href="mailto:security@partsport.agentgaming.gg">security@partsport.agentgaming.gg</a> immediately. We'll lock the account and roll the change back.</p>`;
  await send({
    to: args.to,
    subject: "Your PartsPort email was changed",
    html: wrap("Email change confirmed", body),
    from: FROM_AUTH,
  });
}

export async function sendEmailChangeConfirm(args: {
  to: string;
  name: string;
  confirmUrl: string;
  expiresHours: number;
}): Promise<void> {
  const body = `
    <p>Hi ${esc(args.name)},</p>
    <p>To switch your PartsPort sign-in to this email address, click the button below within the next ${args.expiresHours} hours. The change doesn't take effect until you confirm.</p>
    <p style="margin-top:22px;">${btn(args.confirmUrl, "Confirm new email")}</p>
    <p style="font-size:12.5px;color:#6f6d64;margin-top:16px;">If you didn't request this change, ignore this email.</p>`;
  await send({
    to: args.to,
    subject: "Confirm your new PartsPort email",
    html: wrap("Confirm new email", body),
    from: FROM_AUTH,
  });
}

export async function sendAccountDeletionScheduled(args: {
  to: string;
  name: string;
  graceDays: number;
  recoverUrl: string;
}): Promise<void> {
  const body = `
    <p>Hi ${esc(args.name)},</p>
    <p>Your PartsPort account is scheduled for deletion. We've anonymized your profile and you'll be signed out everywhere. After ${args.graceDays} days, the remaining personal data is hard-deleted.</p>
    <p>If you changed your mind, sign in within the grace period to recover the account:</p>
    <p style="margin-top:22px;">${btn(args.recoverUrl, "Recover account")}</p>
    <p style="font-size:12.5px;color:#6f6d64;margin-top:16px;">Order and invoice records are retained for tax and accounting purposes even after the grace period ends, as described in the Privacy Policy.</p>`;
  await send({
    to: args.to,
    subject: "Your PartsPort account is being deleted",
    html: wrap("Account deletion scheduled", body),
    from: FROM_AUTH,
  });
}

/**
 * Polish 12 M4: dedicated decline email so the buyer hears back even
 * when no quote is produced.
 */
export async function sendQuoteDeclined(quote: QuoteLite): Promise<void> {
  const url = siteUrl(`/catalog`);
  const body = `
    <p>Hi ${esc(quote.buyerName)},</p>
    <p>${esc(quote.supplierName)} is unable to quote your RFQ <strong>${esc(quote.reference)}</strong> for ${esc(quote.productName)} (SKU ${esc(quote.productSku)}, qty ${quote.qty}) at this time.</p>
    <p>You can search for similar parts on PartsPort and submit a new RFQ to other suppliers whenever you're ready.</p>
    <p style="margin-top:22px;">${btn(url, "Browse the catalog")}</p>`;
  await send({
    to: quote.buyerEmail,
    subject: `Quote update for RFQ ${quote.reference}`,
    html: wrap("Quote update", body),
  });
}

type ReturnEmailArgs = {
  to: string;
  buyerName: string;
  orderReference: string;
  returnReference: string;
  reason: string;
  note?: string;
  amountCents?: number;
};

export async function sendReturnApproved(args: ReturnEmailArgs): Promise<void> {
  const url = siteUrl(`/orders`);
  const amountLine =
    args.amountCents && args.amountCents > 0
      ? `<p>Approved refund: <strong>${formatCents(args.amountCents)}</strong>. Funds reach your card in 5 to 10 business days.</p>`
      : "";
  const body = `
    <p>Hi ${esc(args.buyerName)},</p>
    <p>Your return request <strong>${esc(args.returnReference)}</strong> on order <strong>${esc(args.orderReference)}</strong> has been approved.</p>
    ${amountLine}
    ${args.note ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;"><strong>Note:</strong> ${esc(args.note)}</p>` : ""}
    <p style="margin-top:22px;">${btn(url, "View orders")}</p>`;
  await send({
    to: args.to,
    subject: `Return ${args.returnReference} approved`,
    html: wrap("Return approved", body),
  });
}

export async function sendReturnRejected(args: ReturnEmailArgs): Promise<void> {
  const url = siteUrl(`/orders`);
  const body = `
    <p>Hi ${esc(args.buyerName)},</p>
    <p>Your return request <strong>${esc(args.returnReference)}</strong> on order <strong>${esc(args.orderReference)}</strong> has been declined.</p>
    ${args.note ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;"><strong>Reason:</strong> ${esc(args.note)}</p>` : ""}
    <p>Reach support@partsport.agentgaming.gg if you'd like to discuss.</p>
    <p style="margin-top:22px;">${btn(url, "View orders")}</p>`;
  await send({
    to: args.to,
    subject: `Return ${args.returnReference} declined`,
    html: wrap("Return declined", body),
  });
}

export async function sendReturnResolved(args: ReturnEmailArgs): Promise<void> {
  const url = siteUrl(`/orders`);
  const body = `
    <p>Hi ${esc(args.buyerName)},</p>
    <p>Your return request <strong>${esc(args.returnReference)}</strong> on order <strong>${esc(args.orderReference)}</strong> is now marked resolved. Thanks for your patience.</p>
    ${args.note ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;">${esc(args.note)}</p>` : ""}
    <p style="margin-top:22px;">${btn(url, "View orders")}</p>`;
  await send({
    to: args.to,
    subject: `Return ${args.returnReference} resolved`,
    html: wrap("Return resolved", body),
  });
}

export async function sendReturnNotifySupplier(args: {
  to: string;
  supplierName: string;
  orderReference: string;
  returnReference: string;
  status: string;
  reason: string;
  note?: string;
}): Promise<void> {
  const url = siteUrl(`/supplier`);
  const body = `
    <p>A return on order <strong>${esc(args.orderReference)}</strong> for ${esc(args.supplierName)} has been marked <strong>${esc(args.status)}</strong> by admin.</p>
    <p>Reason: ${esc(args.reason)}</p>
    ${args.note ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;"><strong>Note:</strong> ${esc(args.note)}</p>` : ""}
    <p>Reference: ${esc(args.returnReference)}.</p>
    <p style="margin-top:22px;">${btn(url, "Open supplier dashboard")}</p>`;
  await send({
    to: args.to,
    subject: `Return ${args.returnReference} ${args.status.toLowerCase()}`,
    html: wrap("Return update", body),
  });
}

export async function sendPasswordReset(args: {
  to: string;
  name: string;
  resetUrl: string;
  expiresMinutes: number;
}): Promise<void> {
  const body = `
    <p>Hi ${esc(args.name)},</p>
    <p>Someone requested a password reset for your PartsPort account. If that was you, use the button below within the next ${args.expiresMinutes} minutes. If not, you can safely ignore this email.</p>
    <p style="margin-top:22px;">${btn(args.resetUrl, "Reset password")}</p>
    <p style="font-size:12.5px;color:#6f6d64;margin-top:16px;">Or paste this link into your browser: ${args.resetUrl}</p>`;
  await send({
    to: args.to,
    subject: `Reset your PartsPort password`,
    html: wrap("Password reset", body),
    from: FROM_AUTH,
  });
}

/**
 * PLH-1 commit 4: notify a supplier when admin reviews one of their
 * legal documents. APPROVED is a green light; REJECTED prompts the
 * supplier to upload a replacement, with the admin's note in the body.
 */
export async function sendSupplierDocReviewed(args: {
  to: string;
  supplierName: string;
  kind: string;
  status: string;
  reviewNote?: string | null;
}): Promise<void> {
  const url = siteUrl(`/supplier`);
  const niceKind = esc(args.kind.replaceAll("_", " ").toLowerCase());
  const niceStatus = esc(args.status.toLowerCase());
  const isApproved = args.status.toUpperCase() === "APPROVED";
  const headline = isApproved
    ? `Your ${niceKind} document was approved.`
    : `Your ${niceKind} document was marked ${niceStatus}.`;
  const noteBlock = args.reviewNote
    ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;"><strong>Reviewer note:</strong> ${esc(args.reviewNote)}</p>`
    : "";
  const followUp = isApproved
    ? `<p>No action needed. The document counts toward your go-live checklist.</p>`
    : `<p>Open your supplier dashboard to upload a replacement when ready.</p>`;
  const body = `
    <p>Hi ${esc(args.supplierName)},</p>
    <p>${headline}</p>
    ${noteBlock}
    ${followUp}
    <p style="margin-top:22px;">${btn(url, "Open supplier dashboard")}</p>`;
  await send({
    to: args.to,
    subject: `Document ${niceStatus}: ${niceKind}`,
    html: wrap("Document review update", body),
  });
}

/**
 * PLH-1 commit 2: 2FA-disabled notification. Fires on a successful
 * /api/auth/2fa/disable so the user notices an attacker stripping the
 * second factor even if the attacker has the password and session.
 */
export async function sendTwoFactorDisabled(args: {
  to: string;
  name: string;
  ip: string;
  when: Date;
}): Promise<void> {
  const body = `
    <p>Hi ${esc(args.name)},</p>
    <p>Two-factor authentication on your PartsPort account was just disabled.</p>
    <p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;font-size:13px;">
      <strong>When:</strong> ${esc(args.when.toUTCString())}<br>
      <strong>IP:</strong> ${esc(args.ip)}
    </p>
    <p>If this was not you, email <a href="mailto:security@partsport.agentgaming.gg">security@partsport.agentgaming.gg</a> right away and reset your password.</p>`;
  await send({
    to: args.to,
    subject: "Two-factor authentication disabled on your PartsPort account",
    html: wrap("Two-factor disabled", body),
    from: FROM_AUTH,
  });
}

/**
 * PLH-1 commit 2: enumeration-safe "address already registered" notice.
 * Sent to the existing account holder when someone attempts to register
 * with their email, while the public response looks identical to a new
 * registration. Gives the real owner a heads-up + a reset link in case
 * they forgot the account exists.
 */
export async function sendAddressAlreadyRegistered(args: {
  to: string;
  name: string;
  resetUrl: string;
}): Promise<void> {
  const body = `
    <p>Hi ${esc(args.name)},</p>
    <p>Someone just tried to register a new PartsPort account using your email address. Your existing account is unchanged.</p>
    <p>If that was you, you already have an account: use the password-reset link below if you forgot your password.</p>
    <p style="margin-top:22px;">${btn(args.resetUrl, "Reset password")}</p>
    <p style="font-size:12.5px;color:#6f6d64;margin-top:16px;">If it was not you, no action is needed. You can ignore this email.</p>`;
  await send({
    to: args.to,
    subject: "Your PartsPort email was used to register",
    html: wrap("Address already registered", body),
    from: FROM_AUTH,
  });
}

/**
 * PLH-1 commit 2: enumeration-safe "sign-in attempt on deleted account"
 * notice. Sent to the deleted-but-recoverable account holder when a
 * login attempt comes in with the correct password. Public response is
 * the same generic 401 used for wrong password, so we don't leak
 * deletion state.
 */
export async function sendDeletedAccountSignInAttempt(args: {
  to: string;
  name: string;
  recoverUrl: string;
}): Promise<void> {
  const body = `
    <p>Hi ${esc(args.name)},</p>
    <p>We noticed a sign-in attempt on your deleted PartsPort account.</p>
    <p>The account is scheduled for deletion. If you want it back, use the recovery link below within the grace window.</p>
    <p style="margin-top:22px;">${btn(args.recoverUrl, "Recover account")}</p>`;
  await send({
    to: args.to,
    subject: "Sign-in attempt on your deleted PartsPort account",
    html: wrap("Sign-in attempt", body),
    from: FROM_AUTH,
  });
}

/**
 * PLH-3c F3: OEM application emails. Sent on submission (notify admin
 * team), approval (notify OEM), and rejection (notify OEM with reason).
 */
export async function sendOemApplicationSubmitted(args: {
  userEmail: string;
  userName: string;
  manufacturerName: string;
}): Promise<void> {
  const adminTo = process.env.ADMIN_EMAIL || "admin@partsport.agentgaming.gg";
  const reviewUrl = siteUrl("/admin/manufacturer-applications");
  const body = `
    <p>A new OEM brand claim is pending review.</p>
    <p><strong>${esc(args.manufacturerName)}</strong></p>
    <p>Submitted by ${esc(args.userName)} (${esc(args.userEmail)}).</p>
    <p style="margin-top:22px;">${btn(reviewUrl, "Review applications")}</p>`;
  await send({
    to: adminTo,
    subject: `OEM brand claim: ${args.manufacturerName}`,
    html: wrap("New brand claim", body),
  });
}

export async function sendOemApplicationApproved(args: {
  userEmail: string;
  userName: string;
  manufacturerName: string;
}): Promise<void> {
  const url = siteUrl("/oem");
  const body = `
    <p>Hi ${esc(args.userName)},</p>
    <p>Your brand claim for <strong>${esc(args.manufacturerName)}</strong> has been approved. Your storefront is now live and PartsPort distributors can list products under your brand.</p>
    <p style="margin-top:22px;">${btn(url, "Open your dashboard")}</p>`;
  await send({
    to: args.userEmail,
    subject: `Your PartsPort brand "${args.manufacturerName}" is approved`,
    html: wrap("Brand approved", body),
  });
}

export async function sendOemApplicationRejected(args: {
  userEmail: string;
  userName: string;
  manufacturerName: string;
  reason: string;
}): Promise<void> {
  const url = siteUrl("/account");
  const body = `
    <p>Hi ${esc(args.userName)},</p>
    <p>Your brand claim for <strong>${esc(args.manufacturerName)}</strong> was not approved.</p>
    <p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;"><strong>Reason:</strong> ${esc(args.reason)}</p>
    <p>You can update your brand name and re-submit, or reach out to support.</p>
    <p style="margin-top:22px;">${btn(url, "Update your profile")}</p>`;
  await send({
    to: args.userEmail,
    subject: `Your PartsPort brand claim was not approved`,
    html: wrap("Brand claim review", body),
  });
}

/**
 * PLH-3c F7: order cancellation notice. Mirrors sendOrderRefunded but
 * for the pre-shipped cancel path. When refundedCents > 0 the buyer paid
 * already and Stripe is initiating the refund; when 0 the order was
 * never paid so no refund line is shown.
 */
export async function sendOrderCancelled(
  order: OrderLite,
  refundedCents: number
): Promise<void> {
  // PLH-3j P15: respect the buyer's per-user notifyOrderEmails opt-out
  // gate (PLH-3b F1 pattern). Guest orders (no buyerId) always send,
  // since there's no logged-in user to opt out.
  if (order.buyerId) {
    const ok = await shouldSendToUser(order.buyerId, "order");
    if (!ok) return;
  }
  const url = orderViewUrl(order);
  const refundLine =
    refundedCents > 0
      ? `<p>Refund of <strong>${formatCents(refundedCents)}</strong> initiated to your card. Funds reach your issuer in 5 to 10 business days.</p>`
      : "";
  const body = `
    <p>Hi ${esc(order.buyerName)},</p>
    <p>Order <strong>${esc(order.reference)}</strong> has been cancelled.</p>
    ${refundLine}
    ${buyerBranding(order)}
    <p style="margin-top:22px;">${btn(url, "View order")}</p>`;
  await send({
    to: order.buyerEmail,
    subject: `Order ${order.reference} cancelled`,
    html: wrap("Order cancelled", body),
  });
}

/**
 * PLH-3j P4: tax-exempt certificate expiry reminder. Sent by the daily
 * cron 30 days before the cert expires. Buyer can refresh the cert from
 * /settings to keep tax-exempt status active at checkout.
 */
export async function sendTaxExemptExpiryNotice(args: {
  to: string;
  recipientName: string;
  addressLabel: string;
  expiresAt: Date;
  daysLeft: number;
}): Promise<void> {
  const url = siteUrl(`/settings`);
  const pretty = args.expiresAt.toLocaleDateString();
  const body = `
    <p>Hi ${esc(args.recipientName)},</p>
    <p>Your tax-exempt certificate on file for <strong>${esc(args.addressLabel)}</strong> expires on <strong>${esc(pretty)}</strong> (in ${args.daysLeft} days).</p>
    <p>Upload a refreshed certificate to keep tax-exempt status applied at checkout. If the cert lapses, Stripe Tax will compute sales tax on your next order until a current cert is on file.</p>
    <p style="margin-top:22px;">${btn(url, "Refresh certificate")}</p>`;
  await send({
    to: args.to,
    subject: `Tax-exempt certificate expires ${pretty}`,
    html: wrap("Certificate expires soon", body),
  });
}

// ---------------------------------------------------------------------------
// PLH-3y-6 C4: Approval workflow notification emails
// ---------------------------------------------------------------------------

/**
 * Sent to the assigned approver when a new order enters the queue.
 * Embeds one-click approve and reject links signed with approval tokens.
 */
export async function sendApprovalRequested(args: {
  to: string;
  approverName: string;
  buyerName: string;
  orgName: string;
  orderReference: string;
  orderId: string;
  totalCents: number;
  approveUrl: string;
  rejectUrl: string;
}): Promise<void> {
  const orderUrl = siteUrl(`/orders/${args.orderId}`);
  const body = `
    <p>Hi ${esc(args.approverName)},</p>
    <p><strong>${esc(args.buyerName)}</strong> placed order <strong>${esc(args.orderReference)}</strong> for <strong>${formatCents(args.totalCents)}</strong> on behalf of <strong>${esc(args.orgName)}</strong>. This order requires your approval before payment can proceed.</p>
    <p style="margin-top:22px;">${btn(args.approveUrl, "Approve order")}</p>
    <p style="margin-top:10px;"><a href="${args.rejectUrl}" style="color:#b91c1c;font-size:14px;">Reject order</a></p>
    <p style="margin-top:18px;">Or <a href="${orderUrl}">view the full order</a> before deciding.</p>`;
  await send({
    to: args.to,
    subject: `Approval needed: ${args.orderReference} (${formatCents(args.totalCents)})`,
    html: wrap("Order approval request", body),
  });
}

/**
 * Sent to the buyer when their order is approved.
 */
export async function sendApprovalApproved(args: {
  to: string;
  buyerName: string;
  orderReference: string;
  orderId: string;
  totalCents: number;
}): Promise<void> {
  const orderUrl = siteUrl(`/orders/${args.orderId}`);
  const body = `
    <p>Hi ${esc(args.buyerName)},</p>
    <p>Your order <strong>${esc(args.orderReference)}</strong> for <strong>${formatCents(args.totalCents)}</strong> has been approved. You can now complete payment.</p>
    <p style="margin-top:22px;">${btn(orderUrl, "Pay now")}</p>`;
  await send({
    to: args.to,
    subject: `Order approved: ${args.orderReference}`,
    html: wrap("Your order has been approved", body),
  });
}

/**
 * Sent to the buyer when their order is rejected.
 */
export async function sendApprovalRejected(args: {
  to: string;
  buyerName: string;
  orderReference: string;
  orderId: string;
  totalCents: number;
  reason?: string;
}): Promise<void> {
  const orderUrl = siteUrl(`/orders/${args.orderId}`);
  const reasonLine = args.reason
    ? `<p>Reason: ${esc(args.reason)}</p>`
    : "";
  const body = `
    <p>Hi ${esc(args.buyerName)},</p>
    <p>Your order <strong>${esc(args.orderReference)}</strong> for <strong>${formatCents(args.totalCents)}</strong> was not approved by your organization.</p>
    ${reasonLine}
    <p>Contact your organization admin if you have questions.</p>
    <p style="margin-top:22px;">${btn(orderUrl, "View order")}</p>`;
  await send({
    to: args.to,
    subject: `Order not approved: ${args.orderReference}`,
    html: wrap("Order not approved", body),
  });
}

/**
 * Sent to the escalation target when an approval step times out.
 */
export async function sendApprovalEscalated(args: {
  to: string;
  escalateName: string;
  buyerName: string;
  orgName: string;
  orderReference: string;
  orderId: string;
  totalCents: number;
  approveUrl: string;
  rejectUrl: string;
  originalApproverName: string;
}): Promise<void> {
  const orderUrl = siteUrl(`/orders/${args.orderId}`);
  const body = `
    <p>Hi ${esc(args.escalateName)},</p>
    <p>Order <strong>${esc(args.orderReference)}</strong> for <strong>${formatCents(args.totalCents)}</strong> placed by <strong>${esc(args.buyerName)}</strong> at <strong>${esc(args.orgName)}</strong> has been escalated to you because the original approver (${esc(args.originalApproverName)}) has not responded.</p>
    <p style="margin-top:22px;">${btn(args.approveUrl, "Approve order")}</p>
    <p style="margin-top:10px;"><a href="${args.rejectUrl}" style="color:#b91c1c;font-size:14px;">Reject order</a></p>
    <p style="margin-top:18px;">Or <a href="${orderUrl}">view the full order</a>.</p>`;
  await send({
    to: args.to,
    subject: `Escalated for approval: ${args.orderReference}`,
    html: wrap("Approval escalated to you", body),
  });
}

/**
 * Sent to the buyer when an admin bypasses the approval queue.
 */
export async function sendApprovalBypassed(args: {
  to: string;
  buyerName: string;
  orderReference: string;
  orderId: string;
  totalCents: number;
  adminName: string;
}): Promise<void> {
  const orderUrl = siteUrl(`/orders/${args.orderId}`);
  const body = `
    <p>Hi ${esc(args.buyerName)},</p>
    <p>Your order <strong>${esc(args.orderReference)}</strong> for <strong>${formatCents(args.totalCents)}</strong> was approved via an emergency bypass by <strong>${esc(args.adminName)}</strong>. You can now complete payment.</p>
    <p style="margin-top:22px;">${btn(orderUrl, "Pay now")}</p>`;
  await send({
    to: args.to,
    subject: `Order approved (bypass): ${args.orderReference}`,
    html: wrap("Your order has been approved", body),
  });
}

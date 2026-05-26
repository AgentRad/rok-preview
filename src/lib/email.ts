import "server-only";
import { Resend } from "resend";
import { siteUrl } from "./site-url";
import { trackingLink } from "./tracking";
import { formatCents } from "./money";
import { replyAddress, type ThreadKind } from "./inbound-email";
import { captureError } from "./observability";

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
  args: SendArgs & { from?: string }
): Promise<{ ok: boolean }> {
  const c = client();
  if (!c) return { ok: false };
  try {
    await c.emails.send({
      from: args.from || FROM_DEFAULT,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      replyTo: args.replyTo,
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
  items: { nameSnapshot: string; skuSnapshot: string; qty: number; supplierName: string }[];
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
    ? `<span style="font-weight:600;font-size:14px;color:#1a1916;">${order.buyerCompanyName}</span>`
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
        `<tr><td style="padding:6px 0;font-size:13px;">${it.nameSnapshot} <span style="color:#9b988d;">(${it.skuSnapshot})</span></td><td style="padding:6px 0;font-size:13px;text-align:right;">× ${it.qty}</td></tr>`
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

export async function sendOrderConfirmation(order: OrderLite): Promise<void> {
  const url = siteUrl(`/orders/${order.id}`);
  const body = `
    <p>Hi ${order.buyerName},</p>
    <p>We have received your order <strong>${order.reference}</strong>. Payment is the next step. Once received, the supplier will begin preparing your parts.</p>
    ${buyerBranding(order)}
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:12px 0;">${lineRows(order)}</table>
    ${totals(order)}
    <p style="margin-top:22px;">${btn(url, "View order")}</p>`;
  await send({
    to: order.buyerEmail,
    subject: `Order ${order.reference} received`,
    html: wrap("Order received", body),
  });
}

export async function sendPaymentReceived(order: OrderLite): Promise<void> {
  const url = siteUrl(`/orders/${order.id}`);
  const invoiceUrl = siteUrl(`/orders/${order.id}/invoice`);
  const body = `
    <p>Hi ${order.buyerName},</p>
    <p>Thank you. Payment for order <strong>${order.reference}</strong> has been received and the supplier has been notified. We will keep you posted as it moves through fulfillment.</p>
    ${buyerBranding(order)}
    ${totals(order)}
    <p style="margin-top:22px;">${btn(url, "Track order")} &nbsp; <a href="${invoiceUrl}" style="color:#1a1916;font-weight:600;text-decoration:underline;">View invoice</a></p>`;
  await send({
    to: order.buyerEmail,
    subject: `Payment received for order ${order.reference}`,
    html: wrap("Payment received", body),
  });
}

export async function sendOrderShipped(order: OrderLite): Promise<void> {
  const url = siteUrl(`/orders/${order.id}`);
  const link = trackingLink(order.carrier, order.trackingCode);
  const trackBlock = order.carrier
    ? `<div style="margin:14px 0;padding:14px 16px;background:#f3f2ef;border-left:3px solid #1a1916;">
         <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6f6d64;">Tracking</div>
         <div style="font-weight:700;margin-top:4px;">${order.carrier}</div>
         <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#6f6d64;">${order.trackingCode ?? ""}</div>
         ${link ? `<div style="margin-top:10px;"><a href="${link}" style="color:#1a1916;font-weight:600;text-decoration:underline;">Track with the carrier</a></div>` : ""}
       </div>`
    : "";
  const body = `
    <p>Hi ${order.buyerName},</p>
    <p>Your order <strong>${order.reference}</strong> has shipped.</p>
    ${buyerBranding(order)}
    ${trackBlock}
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
  reason: string
): Promise<void> {
  const url = siteUrl(`/orders/${order.id}`);
  const isFull = refundedCents >= order.totalCents;
  const body = `
    <p>Hi ${order.buyerName},</p>
    <p>${isFull ? "A full refund" : `A partial refund of <strong>${formatCents(refundedCents)}</strong>`} has been issued for order <strong>${order.reference}</strong>.</p>
    ${reason ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;"><strong>Reason:</strong> ${reason}</p>` : ""}
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
  const url = siteUrl(`/orders/${order.id}`);
  const body = `
    <p>Hi ${order.buyerName},</p>
    <p>Order <strong>${order.reference}</strong> has been marked delivered. If anything is missing or damaged, please report it within the claim window in the supplier agreement.</p>
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
    <p>Hi ${quote.buyerName},</p>
    <p>We have received your request for a quote on <strong>${quote.productName}</strong> (SKU ${quote.productSku}, qty ${quote.qty}). A vetted supplier is preparing a price. You will see the quote at the link below, typically within one business day.</p>
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
      <p>A new RFQ has landed for <strong>${quote.productName}</strong> (SKU ${quote.productSku}, qty ${quote.qty}) from ${quote.buyerName}.</p>
      ${quote.message ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;">${quote.message}</p>` : ""}
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
    ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;"><strong>Supplier note:</strong> ${quote.quoteNote}</p>`
    : "";
  const body = `
    <p>Hi ${quote.buyerName},</p>
    <p>${quote.supplierName} has responded to your RFQ <strong>${quote.reference}</strong> for ${quote.productName}.</p>
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
           <strong>Email:</strong> ${args.to}<br><strong>Temporary password:</strong> ${args.tempPassword}
         </p>`
      : "<p>Use your existing PartsPort account to sign in.</p>";
    const body = `
      <p>Hi ${args.contactName},</p>
      <p>Your application for <strong>${args.companyName}</strong> has been approved. Welcome to PartsPort.</p>
      ${credsBlock}
      <p style="margin-top:22px;">${btn(url, "Sign in")}</p>`;
    await send({
      to: args.to,
      subject: `${args.companyName} approved on PartsPort`,
      html: wrap("Application approved", body),
    });
  } else {
    const body = `
      <p>Hi ${args.contactName},</p>
      <p>Thank you for your interest. After review, we are not able to onboard <strong>${args.companyName}</strong> at this time. You can reach out at support@partsport.agentgaming.gg if you would like more detail.</p>`;
    await send({
      to: args.to,
      subject: `Update on your PartsPort application`,
      html: wrap("Application update", body),
    });
  }
}

export async function sendThreadMessage(args: {
  to: string;
  senderName: string;
  subjectPrefix: string; // "Order PP-ABC123" or "RFQ RFQ-ABC123"
  context: string; // human-readable line, e.g. "your order for 100 A breakers"
  body: string;
  threadUrl: string;
  threadKind: ThreadKind;
  threadId: string;
}): Promise<void> {
  const safeBody = args.body
    .split("\n")
    .map((line) => `<p style="margin:0 0 8px;">${line || "&nbsp;"}</p>`)
    .join("");
  const reply = replyAddress(args.threadKind, args.threadId);
  const replyHint = reply
    ? `<p style="font-size:12px;color:#6f6d64;margin-top:14px;">Reply to this email and your message posts straight to the thread. Everyone on the thread will see it.</p>`
    : `<p style="font-size:12px;color:#6f6d64;margin-top:14px;">Reply on PartsPort to keep the thread tidy.</p>`;
  const html = wrap(
    "New message",
    `<p>${args.senderName} sent you a message about ${args.context}:</p>
     <div style="margin:14px 0;padding:14px 16px;background:#f3f2ef;border-left:3px solid #1a1916;">${safeBody}</div>
     <p style="margin-top:18px;">${btn(args.threadUrl, "Open thread")}</p>
     ${replyHint}`,
    "Replies sent on PartsPort stay tied to this thread so admin support can step in if needed."
  );
  await send({
    to: args.to,
    subject: `[${args.subjectPrefix}] Message from ${args.senderName}`,
    html,
    replyTo: reply || undefined,
  });
}

export async function sendSupplierWelcome(args: {
  to: string;
  contactName: string;
  companyName: string;
  tempPassword: string | null;
}): Promise<void> {
  const url = siteUrl("/login");
  const credsBlock = args.tempPassword
    ? `<p>A temporary sign-in has been created. Please change your password after the first sign-in (use the Forgot password link if needed).</p>
       <p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;font-family:'IBM Plex Mono',monospace;font-size:13px;">
         <strong>Email:</strong> ${args.to}<br><strong>Temporary password:</strong> ${args.tempPassword}
       </p>`
    : "<p>Use your existing PartsPort account to sign in. Your supplier dashboard is ready.</p>";
  const body = `
    <p>Hi ${args.contactName},</p>
    <p>${args.companyName} has been set up on PartsPort as a verified supplier. Welcome aboard.</p>
    ${credsBlock}
    <p>Once you sign in, you can list parts, manage stock and pricing, respond to RFQs, see incoming orders, and invite your team to specific roles.</p>
    <p style="margin-top:22px;">${btn(url, "Sign in to PartsPort")}</p>`;
  await send({
    to: args.to,
    subject: `${args.companyName} is live on PartsPort`,
    html: wrap("You're set up on PartsPort", body),
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
    <p>${args.inviterName} invited you to join ${args.companyName}'s PartsPort account.</p>
    <p>PartsPort is the marketplace where you sell parts, respond to quote requests, manage orders, and get paid on dispatch. The link below adds you to ${args.companyName}'s team within the next ${args.expiresDays} days.</p>
    <p style="margin-top:22px;">${btn(args.acceptUrl, "Accept invitation")}</p>
    <p style="font-size:12.5px;color:#6f6d64;margin-top:16px;">If you don't have an account yet, you'll be asked to create one in the same step.</p>`;
  await send({
    to: args.to,
    subject: `${args.inviterName} invited you to ${args.companyName} on PartsPort`,
    html: wrap("Team invitation", body),
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
    <p>Hi ${args.name},</p>
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
    <p>Hi ${args.name},</p>
    <p>The email on your PartsPort account was changed from <strong>${args.oldEmail}</strong> to <strong>${args.newEmail}</strong>. From now on, sign-ins and notifications use the new address.</p>
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
    <p>Hi ${args.name},</p>
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
    <p>Hi ${args.name},</p>
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
    <p>Hi ${quote.buyerName},</p>
    <p>${quote.supplierName} is unable to quote your RFQ <strong>${quote.reference}</strong> for ${quote.productName} (SKU ${quote.productSku}, qty ${quote.qty}) at this time.</p>
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
    <p>Hi ${args.buyerName},</p>
    <p>Your return request <strong>${args.returnReference}</strong> on order <strong>${args.orderReference}</strong> has been approved.</p>
    ${amountLine}
    ${args.note ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;"><strong>Note:</strong> ${args.note}</p>` : ""}
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
    <p>Hi ${args.buyerName},</p>
    <p>Your return request <strong>${args.returnReference}</strong> on order <strong>${args.orderReference}</strong> has been declined.</p>
    ${args.note ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;"><strong>Reason:</strong> ${args.note}</p>` : ""}
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
    <p>Hi ${args.buyerName},</p>
    <p>Your return request <strong>${args.returnReference}</strong> on order <strong>${args.orderReference}</strong> is now marked resolved. Thanks for your patience.</p>
    ${args.note ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;">${args.note}</p>` : ""}
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
    <p>A return on order <strong>${args.orderReference}</strong> for ${args.supplierName} has been marked <strong>${args.status}</strong> by admin.</p>
    <p>Reason: ${args.reason}</p>
    ${args.note ? `<p style="background:#f3f2ef;padding:12px 14px;border-radius:4px;color:#3a3833;font-size:13px;"><strong>Note:</strong> ${args.note}</p>` : ""}
    <p>Reference: ${args.returnReference}.</p>
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
    <p>Hi ${args.name},</p>
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

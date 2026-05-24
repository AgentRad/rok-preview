import "server-only";
import { Resend } from "resend";
import { siteUrl } from "./site-url";
import { trackingLink } from "./tracking";
import { formatCents } from "./money";

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
    console.error("[email] send failed:", err);
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
  totalCents: number;
  subtotalCents: number;
  freightCents: number;
  feeCents: number;
  taxCents: number;
  shipTo: string;
  carrier?: string | null;
  trackingCode?: string | null;
  items: { nameSnapshot: string; skuSnapshot: string; qty: number; supplierName: string }[];
};

function lineRows(order: OrderLite): string {
  return order.items
    .map(
      (it) =>
        `<tr><td style="padding:6px 0;font-size:13px;">${it.nameSnapshot} <span style="color:#9b988d;">(${it.skuSnapshot})</span></td><td style="padding:6px 0;font-size:13px;text-align:right;">× ${it.qty}</td></tr>`
    )
    .join("");
}

function totals(order: OrderLite): string {
  return `
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-top:12px;border-top:1px solid #e2e0d9;">
      <tr><td style="padding:6px 0;font-size:13px;">Subtotal</td><td style="padding:6px 0;font-size:13px;text-align:right;">${formatCents(order.subtotalCents)}</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;">Freight</td><td style="padding:6px 0;font-size:13px;text-align:right;">${formatCents(order.freightCents)}</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;">Platform fee</td><td style="padding:6px 0;font-size:13px;text-align:right;">${formatCents(order.feeCents)}</td></tr>
      <tr><td style="padding:6px 0;font-size:13px;">Sales tax</td><td style="padding:6px 0;font-size:13px;text-align:right;">${formatCents(order.taxCents)}</td></tr>
      <tr><td style="padding:8px 0 0;font-size:14px;font-weight:700;border-top:1px solid #1a1916;">Total</td><td style="padding:8px 0 0;font-size:14px;font-weight:700;text-align:right;border-top:1px solid #1a1916;">${formatCents(order.totalCents)}</td></tr>
    </table>`;
}

export async function sendOrderConfirmation(order: OrderLite): Promise<void> {
  const url = siteUrl(`/orders/${order.id}`);
  const body = `
    <p>Hi ${order.buyerName},</p>
    <p>We have received your order <strong>${order.reference}</strong>. Payment is the next step. Once received, the supplier will begin preparing your parts.</p>
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
    ${trackBlock}
    <p>For LTL freight, please inspect the shipment on arrival and note any damage on the carrier delivery receipt before signing.</p>
    <p style="margin-top:22px;">${btn(url, "View order")}</p>`;
  await send({
    to: order.buyerEmail,
    subject: `Your PartsPort order ${order.reference} has shipped`,
    html: wrap("Your order is on the way", body),
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
  const body = `
    <p>Hi ${quote.buyerName},</p>
    <p>We have received your request for a quote on <strong>${quote.productName}</strong> (SKU ${quote.productSku}, qty ${quote.qty}). A vetted supplier is preparing a price. You will see the quote at the link below, typically within one business day.</p>
    <p style="margin-top:22px;">${btn(url, "View RFQ")}</p>`;
  await send({
    to: quote.buyerEmail,
    subject: `RFQ ${quote.reference} received`,
    html: wrap("RFQ received", body),
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

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import {
  inboundProvider,
  parseReplyAddress,
  stripQuotedReply,
  isInboundConfigured,
} from "@/lib/inbound-email";
import { sendThreadMessage } from "@/lib/email";
import { siteUrl } from "@/lib/site-url";
import {
  canSendMessages,
  userHasAccessToSupplier,
} from "@/lib/supplier-access";

export const runtime = "nodejs";

/**
 * Inbound email webhook. Handles per-thread reply addresses created by
 * `replyAddress(kind, id)` in `src/lib/inbound-email.ts`.
 *
 * Supports three provider payload shapes (switched by INBOUND_EMAIL_PROVIDER):
 *   - resend:   { from, to, subject, text, html }
 *   - postmark: { From, ToFull[], Subject, TextBody, HtmlBody }
 *   - sendgrid: multipart form with from/to/subject/text/html fields
 *
 * Signature verification:
 *   - postmark: shared secret in Postmark UI; verify against
 *     X-Postmark-Webhook-Token header (if INBOUND_WEBHOOK_SECRET is set).
 *   - resend / sendgrid: optional shared secret via the same env var,
 *     compared against the request's `Authorization: Bearer <secret>` header.
 */

type ParsedInbound = {
  from: string;
  recipients: string[];
  subject: string;
  text: string;
  html: string;
};

async function parseBody(req: Request): Promise<ParsedInbound | null> {
  const provider = inboundProvider();
  const contentType = req.headers.get("content-type") || "";
  if (provider === "postmark") {
    const body = await req.json().catch(() => null);
    if (!body) return null;
    const toFull = Array.isArray(body.ToFull) ? body.ToFull : [];
    const recipients: string[] = toFull
      .map((r: { Email?: string }) => (r?.Email ? String(r.Email) : ""))
      .filter(Boolean);
    return {
      from: String(body.FromFull?.Email || body.From || "").trim(),
      recipients,
      subject: String(body.Subject || ""),
      text: String(body.TextBody || ""),
      html: String(body.HtmlBody || ""),
    };
  }
  if (provider === "sendgrid") {
    // SendGrid Inbound Parse posts multipart/form-data.
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const toRaw = String(form.get("to") || "");
      return {
        from: String(form.get("from") || "").trim(),
        recipients: toRaw.split(",").map((s) => s.trim()).filter(Boolean),
        subject: String(form.get("subject") || ""),
        text: String(form.get("text") || ""),
        html: String(form.get("html") || ""),
      };
    }
    return null;
  }
  // Default: Resend / generic JSON shape.
  const body = await req.json().catch(() => null);
  if (!body) return null;
  const to = body.to ?? body.To ?? "";
  const recipients: string[] = Array.isArray(to)
    ? to.map((v: string) => String(v))
    : String(to)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  return {
    from: String(body.from ?? body.From ?? "").trim(),
    recipients,
    subject: String(body.subject ?? body.Subject ?? ""),
    text: String(body.text ?? body.TextBody ?? ""),
    html: String(body.html ?? body.HtmlBody ?? ""),
  };
}

function verifyAuth(req: Request): boolean {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) return true; // Verification optional during early launch.
  // Postmark sends X-Postmark-Webhook-Token; everyone else uses bearer.
  const postmarkHdr = req.headers.get("x-postmark-webhook-token") || "";
  if (postmarkHdr) {
    return (
      postmarkHdr.length === secret.length &&
      crypto.timingSafeEqual(
        Buffer.from(postmarkHdr, "utf8"),
        Buffer.from(secret, "utf8")
      )
    );
  }
  const auth = req.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  return (
    auth.length === expected.length &&
    crypto.timingSafeEqual(
      Buffer.from(auth, "utf8"),
      Buffer.from(expected, "utf8")
    )
  );
}

/**
 * Extract a bare email address from a value that might be "Name <a@b.com>".
 */
function extractEmail(raw: string): string {
  const angled = raw.match(/<([^>]+)>/);
  return (angled ? angled[1] : raw).trim().toLowerCase();
}

// Tiny in-memory rate limit on bounce-back replies so a stuck sender can't
// flood. Process-local; good enough for the early-launch volume.
const recentBounces = new Map<string, number>();
function shouldBounce(senderEmail: string): boolean {
  const now = Date.now();
  const last = recentBounces.get(senderEmail) || 0;
  if (now - last < 5 * 60 * 1000) return false;
  recentBounces.set(senderEmail, now);
  // Cap map size.
  if (recentBounces.size > 500) {
    for (const [k, v] of recentBounces) {
      if (now - v > 60 * 60 * 1000) recentBounces.delete(k);
    }
  }
  return true;
}

export async function POST(req: Request) {
  if (!isInboundConfigured()) {
    return NextResponse.json(
      { error: "Inbound email is not configured." },
      { status: 503 }
    );
  }
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }
  const parsed = await parseBody(req);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  const senderEmail = extractEmail(parsed.from);
  if (!senderEmail) {
    return NextResponse.json({ ok: true, ignored: "no sender" });
  }

  // Find the first recipient that matches our reply pattern; ignore the rest
  // (CCs to other distribution addresses are not our concern).
  let target = null as ReturnType<typeof parseReplyAddress>;
  for (const r of parsed.recipients) {
    const t = parseReplyAddress(r);
    if (t) {
      target = t;
      break;
    }
  }
  if (!target) {
    // Not one of our reply addresses; drop quietly.
    return NextResponse.json({ ok: true, ignored: "no reply token" });
  }

  // Match sender to a known user. Reply must come from a recognized email so
  // we never attribute a message to the wrong account.
  const user = await prisma.user.findUnique({
    where: { email: senderEmail },
  });
  if (!user) {
    if (shouldBounce(senderEmail)) {
      const url =
        target.kind === "order"
          ? siteUrl(`/orders/${target.id}`)
          : siteUrl(`/quotes/${target.id}`);
      await sendThreadMessage({
        to: senderEmail,
        senderName: "PartsPort",
        subjectPrefix: target.kind === "order" ? "Order reply" : "RFQ reply",
        context: "your reply",
        body:
          "We couldn't match your email to a PartsPort account, so your reply was not posted to the thread. Sign in and reply on PartsPort at the link below, or reply from the email address that received the original message.",
        threadUrl: url,
        threadKind: target.kind,
        threadId: target.id,
      }).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, ignored: "unknown sender" });
  }

  const cleaned = stripQuotedReply(parsed.text || parsed.html || "");
  if (!cleaned) {
    return NextResponse.json({ ok: true, ignored: "empty body" });
  }

  // Confirm the user is actually on this thread (buyer / supplier / admin).
  if (target.kind === "order") {
    const order = await prisma.order.findUnique({
      where: { id: target.id },
      include: { items: { include: { product: { include: { supplier: true } } } } },
    });
    if (!order) {
      return NextResponse.json({ ok: true, ignored: "order missing" });
    }
    const supplierIds = Array.from(
      new Set(order.items.map((i) => i.product.supplierId))
    );
    const isBuyer = !!order.buyerId && order.buyerId === user.id;
    const isAdmin = user.role === "ADMIN";
    let isOrderSupplier = false;
    if (user.role === "SUPPLIER") {
      const checks = await Promise.all(
        supplierIds.map((id) => userHasAccessToSupplier(user.id, id))
      );
      isOrderSupplier = checks.some((c) => c.ok && canSendMessages(c.role));
    }
    if (!isBuyer && !isAdmin && !isOrderSupplier) {
      return NextResponse.json({ ok: true, ignored: "not on thread" });
    }
    await prisma.message.create({
      data: {
        orderId: order.id,
        senderId: user.id,
        senderName: user.name,
        senderEmail: user.email,
        senderRole: user.role,
        body: cleaned.slice(0, 4000),
      },
    });
    // Fan out to the other people on the thread (mirrors POST /api/messages).
    const recipients = new Set<string>();
    if (!isBuyer) recipients.add(order.buyerEmail);
    for (const it of order.items) {
      if (!isOrderSupplier) recipients.add(it.product.supplier?.contactEmail || "");
    }
    recipients.delete("");
    recipients.delete(user.email);
    for (const to of recipients) {
      sendThreadMessage({
        to,
        senderName: user.name,
        subjectPrefix: `Order ${order.reference}`,
        context: `order ${order.reference}`,
        body: cleaned,
        threadUrl: siteUrl(`/orders/${order.id}`),
        threadKind: "order",
        threadId: order.id,
      }).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, posted: "order", id: order.id });
  }

  // Quote thread.
  const quote = await prisma.quoteRequest.findUnique({
    where: { id: target.id },
    include: { product: { include: { supplier: true } } },
  });
  if (!quote) {
    return NextResponse.json({ ok: true, ignored: "quote missing" });
  }
  const isBuyer = !!quote.buyerId && quote.buyerId === user.id;
  const isAdmin = user.role === "ADMIN";
  let isQuoteSupplier = false;
  if (user.role === "SUPPLIER") {
    const access = await userHasAccessToSupplier(
      user.id,
      quote.product.supplierId
    );
    isQuoteSupplier = access.ok && canSendMessages(access.role);
  }
  if (!isBuyer && !isAdmin && !isQuoteSupplier) {
    return NextResponse.json({ ok: true, ignored: "not on thread" });
  }
  await prisma.message.create({
    data: {
      quoteId: quote.id,
      senderId: user.id,
      senderName: user.name,
      senderEmail: user.email,
      senderRole: user.role,
      body: cleaned.slice(0, 4000),
    },
  });
  const recipients = new Set<string>();
  if (!isBuyer) recipients.add(quote.buyerEmail);
  if (!isQuoteSupplier) recipients.add(quote.product.supplier.contactEmail);
  recipients.delete("");
  recipients.delete(user.email);
  for (const to of recipients) {
    sendThreadMessage({
      to,
      senderName: user.name,
      subjectPrefix: `RFQ ${quote.reference}`,
      context: `RFQ ${quote.reference} for ${quote.product.name}`,
      body: cleaned,
      threadUrl: siteUrl(`/quotes/${quote.id}`),
      threadKind: "quote",
      threadId: quote.id,
    }).catch(() => undefined);
  }
  return NextResponse.json({ ok: true, posted: "quote", id: quote.id });
}

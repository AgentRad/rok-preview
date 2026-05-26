import { NextResponse, after } from "next/server";
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

/** Cap on what we'll save into the database, regardless of payload size. */
const MAX_STORED_BODY = 4000;
/** Cap on the inbound body we'll even parse, in chars. Anything beyond is */
/** almost certainly an attachment-laden mega-thread, and we strip quoted */
/** history anyway. */
const MAX_PARSE_BODY = 200_000;

/** Convert basic HTML to plain text. Best-effort, no full parser. */
function htmlToText(html: string): string {
  if (!html) return "";
  return html
    // Drop <style> and <script> blocks entirely
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    // Block-level breaks become newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|br|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Strip all other tags
    .replace(/<[^>]+>/g, "")
    // Decode common entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse runs of blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chooseProvider(req: Request): "resend" | "postmark" | "sendgrid" | null {
  // Prefer the explicit env-configured provider. Fall back to a best-guess
  // based on headers / content-type, so a wrong env var doesn't silently
  // reject otherwise-valid traffic.
  const envProvider = inboundProvider();
  if (envProvider) return envProvider;
  if (req.headers.get("x-postmark-webhook-token")) return "postmark";
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    return "sendgrid";
  }
  return "resend";
}

async function parseBody(req: Request): Promise<ParsedInbound | null> {
  const provider = chooseProvider(req);
  if (!provider) return null;

  if (provider === "postmark") {
    const text = await req.text().catch(() => "");
    if (!text || text.length > MAX_PARSE_BODY) return null;
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      return null;
    }
    const toFull = Array.isArray(body.ToFull) ? body.ToFull : [];
    const recipients: string[] = toFull
      .map((r: { Email?: string }) => (r?.Email ? String(r.Email) : ""))
      .filter(Boolean);
    const fromFull = body.FromFull as { Email?: string } | undefined;
    return {
      from: String(fromFull?.Email || body.From || "").trim(),
      recipients,
      subject: String(body.Subject || ""),
      text: String(body.TextBody || ""),
      html: String(body.HtmlBody || ""),
    };
  }

  if (provider === "sendgrid") {
    // SendGrid Inbound Parse posts multipart/form-data.
    if (!req.headers.get("content-type")?.includes("multipart/form-data")) {
      return null;
    }
    const form = await req.formData().catch(() => null);
    if (!form) return null;
    const toRaw = String(form.get("to") || "");
    return {
      from: String(form.get("from") || "").trim(),
      recipients: toRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      subject: String(form.get("subject") || ""),
      text: String(form.get("text") || ""),
      html: String(form.get("html") || ""),
    };
  }

  // Resend / generic JSON
  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > MAX_PARSE_BODY) return null;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const to = body.to ?? body.To ?? "";
  const recipients: string[] = Array.isArray(to)
    ? to.map((v: unknown) => String(v))
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
  try {
    return await handleInbound(req);
  } catch (err) {
    console.error("[email][inbound] handler crashed:", err);
    // Return 500 so the provider knows to retry, not a 200 ack.
    return NextResponse.json(
      { error: "Inbound handler failed; will be retried." },
      { status: 500 }
    );
  }
}

async function handleInbound(req: Request) {
  // Fail-closed: if the provider env var is unset, the feature is off.
  // Return 404 so the route looks absent to scanners and misconfigured
  // webhooks, rather than advertising a disabled inbound surface.
  if (!inboundProvider()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
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

  // Prefer the plain-text part; fall back to HTML stripped to text. This
  // matters for Outlook on the web, which sometimes sends only HTML.
  const raw = parsed.text || htmlToText(parsed.html);
  const cleaned = stripQuotedReply(raw).slice(0, MAX_STORED_BODY);
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
        body: cleaned,
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
    // P9.5 HIGH 11: wrap in after() so the function stays alive past
    // the response on Vercel serverless. Pre-fix the fire-and-forget
    // .catch() pattern would drop the email on cold-start kill.
    after(async () => {
      for (const to of recipients) {
        try {
          await sendThreadMessage({
            to,
            senderName: user.name,
            subjectPrefix: `Order ${order.reference}`,
            context: `order ${order.reference}`,
            body: cleaned,
            threadUrl: siteUrl(`/orders/${order.id}`),
            threadKind: "order",
            threadId: order.id,
          });
        } catch {
          // Per-recipient swallow; one bad address doesn't drop the rest.
        }
      }
    });
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
      body: cleaned,
    },
  });
  const recipients = new Set<string>();
  if (!isBuyer) recipients.add(quote.buyerEmail);
  if (!isQuoteSupplier) recipients.add(quote.product.supplier.contactEmail);
  recipients.delete("");
  recipients.delete(user.email);
  // P9.5 HIGH 11: same after() wrap for the quote thread side.
  after(async () => {
    for (const to of recipients) {
      try {
        await sendThreadMessage({
          to,
          senderName: user.name,
          subjectPrefix: `RFQ ${quote.reference}`,
          context: `RFQ ${quote.reference} for ${quote.product.name}`,
          body: cleaned,
          threadUrl: siteUrl(`/quotes/${quote.id}`),
          threadKind: "quote",
          threadId: quote.id,
        });
      } catch {
        // swallow per-recipient; the rest still send.
      }
    }
  });
  return NextResponse.json({ ok: true, posted: "quote", id: quote.id });
}

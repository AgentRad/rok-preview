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
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";
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
 *   - resend:   { type, data: { from, to, subject, email_id, message_id,
 *                attachments, ... } } — the webhook payload is METADATA ONLY.
 *               text/html are NOT in the webhook; we fetch them via
 *               GET https://api.resend.com/emails/receiving/{email_id} with
 *               Authorization: Bearer ${RESEND_API_KEY} when missing.
 *   - postmark: { From, ToFull[], Subject, TextBody, HtmlBody }
 *   - sendgrid: multipart form with from/to/subject/text/html fields
 *
 * Signature verification:
 *   - postmark: shared secret in Postmark UI; verify against
 *     X-Postmark-Webhook-Token header (if INBOUND_WEBHOOK_SECRET is set).
 *   - resend: Svix-style signed headers (svix-id, svix-timestamp,
 *     svix-signature) verified against the `whsec_*` secret in
 *     INBOUND_WEBHOOK_SECRET. Rejects when timestamp drift exceeds 5 min.
 *   - sendgrid: optional shared secret compared against the request's
 *     `Authorization: Bearer <secret>` header.
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

function parseBodyFromRaw(
  rawBody: string,
  provider: "resend" | "postmark" | "sendgrid",
  req: Request
): ParsedInbound | null {
  if (provider === "postmark") {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
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
    // SendGrid Inbound Parse historically posts multipart/form-data; in
    // practice we accept either x-www-form-urlencoded or multipart here.
    // Parse the raw body via URLSearchParams (URL-encoded). Multipart
    // bodies are not currently supported by this path; if needed, add
    // a multipart parse driven off `req.headers.get("content-type")`.
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/x-www-form-urlencoded")) {
      const form = new URLSearchParams(rawBody);
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
    // Fall through: try JSON in case the user has SendGrid pointed at
    // a JSON-style relay.
  }

  // Resend / generic JSON (and fall-through for sendgrid JSON relays).
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  // Resend wraps the inbound payload under { type, data: { ... } }.
  const dataNode =
    body && typeof body === "object" && body !== null && "data" in body &&
    typeof (body as { data?: unknown }).data === "object" &&
    (body as { data?: unknown }).data !== null
      ? ((body as { data: Record<string, unknown> }).data)
      : body;
  const to = dataNode.to ?? dataNode.To ?? "";
  const recipients: string[] = Array.isArray(to)
    ? to.map((v: unknown) => String(v))
    : String(to)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  return {
    from: String(dataNode.from ?? dataNode.From ?? "").trim(),
    recipients,
    subject: String(dataNode.subject ?? dataNode.Subject ?? ""),
    text: String(dataNode.text ?? dataNode.TextBody ?? ""),
    html: String(dataNode.html ?? dataNode.HtmlBody ?? ""),
  };
}

/**
 * Verify the inbound webhook request based on the configured provider.
 *
 * - postmark: shared-secret X-Postmark-Webhook-Token, timing-safe-equal.
 * - resend: Svix v1 signature over `${svix-id}.${svix-timestamp}.${rawBody}`,
 *   HMAC-SHA256 with a key derived from `whsec_*`-stripped base64 decode of
 *   INBOUND_WEBHOOK_SECRET. Rejects when timestamp drifts more than 5 min.
 * - sendgrid: shared-secret `Authorization: Bearer <secret>`.
 *
 * PLH-3b F5 rule preserved: in production with no secret set, fail closed.
 * In dev, missing secret passes through to keep local testing painless.
 */
function verifyAuth(
  req: Request,
  provider: "resend" | "postmark" | "sendgrid",
  rawBody: string
): boolean {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") return false;
    return true;
  }

  if (provider === "postmark") {
    const postmarkHdr = req.headers.get("x-postmark-webhook-token") || "";
    if (!postmarkHdr) return false;
    if (postmarkHdr.length !== secret.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(postmarkHdr, "utf8"),
      Buffer.from(secret, "utf8")
    );
  }

  if (provider === "resend") {
    return verifySvix(req, rawBody, secret);
  }

  // sendgrid (and any unknown future provider): bearer fallback.
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
 * Svix v1 signature verification. Resend's inbound webhooks are delivered
 * by Svix and ship three headers: svix-id, svix-timestamp, svix-signature.
 * The signature header is a space-separated list of `v<n>,<base64>` entries;
 * any v1 entry matching our recomputed HMAC accepts.
 *
 * Reference: https://docs.svix.com/receiving/verifying-payloads/how-manual
 */
function verifySvix(req: Request, rawBody: string, secret: string): boolean {
  const id = req.headers.get("svix-id") || "";
  const ts = req.headers.get("svix-timestamp") || "";
  const sig = req.headers.get("svix-signature") || "";
  if (!id || !ts || !sig) return false;

  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > 5 * 60) return false;

  // Strip `whsec_` prefix then base64-decode to get the raw HMAC key.
  const keyBase64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Buffer;
  try {
    keyBytes = Buffer.from(keyBase64, "base64");
  } catch {
    return false;
  }
  if (keyBytes.length === 0) return false;

  const signedPayload = `${id}.${ts}.${rawBody}`;
  const computed = crypto
    .createHmac("sha256", keyBytes)
    .update(signedPayload, "utf8")
    .digest("base64");
  const computedBuf = Buffer.from(computed, "utf8");

  for (const entry of sig.split(" ")) {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) continue;
    const valueBuf = Buffer.from(value, "utf8");
    if (valueBuf.length !== computedBuf.length) continue;
    if (crypto.timingSafeEqual(valueBuf, computedBuf)) return true;
  }
  return false;
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
  const provider = chooseProvider(req);
  if (!provider) {
    return NextResponse.json({ error: "Bad provider." }, { status: 400 });
  }
  // Capture the raw body exactly once. Svix verification needs the
  // unparsed bytes, and we must not call req.text() / req.formData()
  // again afterwards (each consumes the body).
  const rawBody = await req.text().catch(() => "");
  if (!rawBody || rawBody.length > MAX_PARSE_BODY) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  if (!verifyAuth(req, provider, rawBody)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }
  const parsed = parseBodyFromRaw(rawBody, provider, req);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  // Resend's email.received webhook ships METADATA ONLY: no text/html in the
  // payload. Fetch the full body via the receiving API when missing.
  if (provider === "resend" && !parsed.text && !parsed.html) {
    let emailId = "";
    try {
      const rawJson = JSON.parse(rawBody) as { data?: { email_id?: unknown } };
      emailId = String(rawJson?.data?.email_id || "");
    } catch {
      emailId = "";
    }
    if (emailId) {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        console.error(
          `[email][inbound] body fetch skipped, RESEND_API_KEY unset email_id=${emailId}`
        );
        return NextResponse.json({ ok: true, ignored: "body fetch failed" });
      }
      try {
        const r = await fetch(
          `https://api.resend.com/emails/receiving/${emailId}`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        );
        if (!r.ok) {
          captureError(new Error(`resend body fetch HTTP ${r.status}`), {
            subsystem: "email",
            op: "inbound-body-fetch",
            emailId,
          });
          return NextResponse.json({ ok: true, ignored: "body fetch failed" });
        }
        const full = (await r.json()) as { text?: unknown; html?: unknown };
        parsed.text = typeof full.text === "string" ? full.text : "";
        parsed.html = typeof full.html === "string" ? full.html : "";
        console.log(
          `[email][inbound] resend body fetched email_id=${emailId} text.length=${parsed.text.length} html.length=${parsed.html.length}`
        );
      } catch (err) {
        captureError(err, { subsystem: "email", op: "inbound-body-fetch", emailId });
        return NextResponse.json({ ok: true, ignored: "body fetch failed" });
      }
    }
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
        body:
          "We couldn't match your email to a PartsPort account, so your reply was not posted to the thread. Sign in and reply on PartsPort at the link below, or reply from the email address that received the original message.",
        threadUrl: url,
        threadKind: target.kind,
        threadId: target.id,
        recipientUserId: null,
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
    if (order.status === "REFUNDED" || order.status === "CANCELLED") {
      await writeAuditLog({
        actor: { id: user.id, email: user.email },
        action: "INBOUND_REPLY_REJECTED",
        targetType: "Order",
        targetId: order.id,
        summary: `Inbound reply rejected, order status ${order.status}`,
        metadata: {
          kind: "order",
          id: order.id,
          status: order.status,
          senderEmail,
        },
      });
      return NextResponse.json({ ok: true, ignored: "thread closed" });
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
    const orderFingerprint = crypto
      .createHash("sha256")
      .update(`${user.id}|${order.id}||${cleaned.trim()}`)
      .digest("hex");
    let createdId = "";
    try {
      const created = await prisma.message.create({
        data: {
          orderId: order.id,
          senderId: user.id,
          senderName: user.name,
          senderEmail: user.email,
          senderRole: user.role,
          body: cleaned,
          inboundFingerprint: orderFingerprint,
        },
      });
      createdId = created.id;
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "P2002") {
        return NextResponse.json({ ok: true, ignored: "duplicate" });
      }
      throw err;
    }
    const prevRow = await prisma.message.findFirst({
      where: { orderId: order.id, NOT: { id: createdId } },
      orderBy: { createdAt: "desc" },
      select: { senderName: true, senderEmail: true, body: true, createdAt: true },
    });
    const prevMessage = prevRow
      ? {
          senderName: prevRow.senderName,
          senderEmail: prevRow.senderEmail,
          body: prevRow.body,
          createdAt: prevRow.createdAt,
        }
      : null;
    // Fan out to the other people on the thread (mirrors POST /api/messages).
    const recipients = new Set<string>();
    const recipientUserIds = new Map<string, string | null>();
    if (!isBuyer) {
      recipients.add(order.buyerEmail);
      recipientUserIds.set(order.buyerEmail, order.buyerId || null);
    }
    for (const it of order.items) {
      if (!isOrderSupplier) {
        const email = it.product.supplier?.contactEmail || "";
        recipients.add(email);
        if (email && !recipientUserIds.has(email)) {
          recipientUserIds.set(email, null);
        }
      }
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
            body: cleaned,
            threadUrl: siteUrl(`/orders/${order.id}`),
            threadKind: "order",
            threadId: order.id,
            recipientUserId: recipientUserIds.get(to) ?? null,
            prevMessage,
          });
        } catch (err) {
          captureError(err, { subsystem: "email", op: "inbound-fan-out", to });
          await writeAuditLog({
            actor: { id: user.id, email: user.email },
            action: "INBOUND_FAN_OUT_FAILED",
            targetType: "Order",
            targetId: order.id,
            summary: `Inbound fan-out failed to ${to}`,
            metadata: {
              threadKind: "order",
              threadId: order.id,
              to,
              error: String(err),
            },
          });
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
  const quoteExpired =
    !!quote.quoteExpiresAt && quote.quoteExpiresAt.getTime() < Date.now();
  const reportedStatus =
    quote.status === "DECLINED" || quote.status === "ACCEPTED"
      ? quote.status
      : quoteExpired
        ? "EXPIRED"
        : null;
  if (reportedStatus) {
    await writeAuditLog({
      actor: { id: user.id, email: user.email },
      action: "INBOUND_REPLY_REJECTED",
      targetType: "QuoteRequest",
      targetId: quote.id,
      summary: `Inbound reply rejected, quote status ${reportedStatus}`,
      metadata: {
        kind: "quote",
        id: quote.id,
        status: reportedStatus,
        senderEmail,
      },
    });
    return NextResponse.json({ ok: true, ignored: "thread closed" });
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
  const quoteFingerprint = crypto
    .createHash("sha256")
    .update(`${user.id}||${quote.id}|${cleaned.trim()}`)
    .digest("hex");
  let createdQuoteMsgId = "";
  try {
    const created = await prisma.message.create({
      data: {
        quoteId: quote.id,
        senderId: user.id,
        senderName: user.name,
        senderEmail: user.email,
        senderRole: user.role,
        body: cleaned,
        inboundFingerprint: quoteFingerprint,
      },
    });
    createdQuoteMsgId = created.id;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "P2002") {
      return NextResponse.json({ ok: true, ignored: "duplicate" });
    }
    throw err;
  }
  const prevQuoteRow = await prisma.message.findFirst({
    where: { quoteId: quote.id, NOT: { id: createdQuoteMsgId } },
    orderBy: { createdAt: "desc" },
    select: { senderName: true, senderEmail: true, body: true, createdAt: true },
  });
  const prevQuoteMessage = prevQuoteRow
    ? {
        senderName: prevQuoteRow.senderName,
        senderEmail: prevQuoteRow.senderEmail,
        body: prevQuoteRow.body,
        createdAt: prevQuoteRow.createdAt,
      }
    : null;
  const recipients = new Set<string>();
  const recipientUserIds = new Map<string, string | null>();
  if (!isBuyer) {
    recipients.add(quote.buyerEmail);
    recipientUserIds.set(quote.buyerEmail, quote.buyerId || null);
  }
  if (!isQuoteSupplier) {
    recipients.add(quote.product.supplier.contactEmail);
    if (!recipientUserIds.has(quote.product.supplier.contactEmail)) {
      recipientUserIds.set(quote.product.supplier.contactEmail, null);
    }
  }
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
          body: cleaned,
          threadUrl: siteUrl(`/quotes/${quote.id}`),
          threadKind: "quote",
          threadId: quote.id,
          recipientUserId: recipientUserIds.get(to) ?? null,
          prevMessage: prevQuoteMessage,
        });
      } catch (err) {
        captureError(err, { subsystem: "email", op: "inbound-fan-out", to });
        await writeAuditLog({
          actor: { id: user.id, email: user.email },
          action: "INBOUND_FAN_OUT_FAILED",
          targetType: "QuoteRequest",
          targetId: quote.id,
          summary: `Inbound fan-out failed to ${to}`,
          metadata: {
            threadKind: "quote",
            threadId: quote.id,
            to,
            error: String(err),
          },
        });
      }
    }
  });
  return NextResponse.json({ ok: true, posted: "quote", id: quote.id });
}

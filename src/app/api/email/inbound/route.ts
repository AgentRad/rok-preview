import { NextResponse } from "next/server";
import { createHmac, createHash } from "crypto";
import { prisma } from "@/lib/db";
import { parseReplyAddress, stripQuotedReply } from "@/lib/inbound-email";

const MAX_BOUNCE_PER_HOUR = 5;
const BOUNCE_CACHE = new Map<string, { count: number; expiresAt: number }>();

function checkBounceLimit(from: string): boolean {
  const now = Date.now();
  const entry = BOUNCE_CACHE.get(from);

  if (!entry || entry.expiresAt < now) {
    BOUNCE_CACHE.set(from, { count: 1, expiresAt: now + 3600000 });
    return true;
  }

  if (entry.count >= MAX_BOUNCE_PER_HOUR) {
    return false;
  }

  entry.count++;
  return true;
}

async function sendBounce(to: string, reason: string): Promise<void> {
  if (!checkBounceLimit(to)) return;

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "PartsPort <noreply@partsport.agentgaming.gg>",
      to,
      subject: "Message not delivered",
      html: `<p>We couldn't deliver your message. ${reason}</p><p>Please visit <a href="https://partsport.agentgaming.gg">PartsPort</a> to continue the conversation.</p>`,
    });
  } catch (err) {
    console.error("[inbound] bounce failed:", err);
  }
}

function verifyWebhookSignature(body: string): boolean {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) return true; // Optional

  const headerSig = (require("next/request") as any).headers?.get?.("x-webhook-signature");
  if (!headerSig) return false;

  const hash = createHmac("sha256", secret).update(body).digest("hex");
  return hash === headerSig;
}

async function handleResendInbound(payload: any) {
  const { from, subject, text, html } = payload;
  const body = stripQuotedReply(text || "");

  if (!from || !body) {
    return { error: "Missing from or body" };
  }

  const replySecret = process.env.INBOUND_REPLY_SECRET;
  if (!replySecret) {
    return { error: "Inbound reply secret not configured" };
  }

  // Extract recipient to parse the reply address
  const [localPart] = (payload.to as string)?.split("@") || [];
  if (!localPart?.startsWith("reply+")) {
    await sendBounce(from, "This email address is not set up to receive replies.");
    return { error: "Invalid reply address" };
  }

  const parsed = parseReplyAddress(payload.to, replySecret);
  if (!parsed) {
    await sendBounce(from, "This reply address is no longer valid.");
    return { error: "Invalid reply address signature" };
  }

  const { kind, id } = parsed;

  // Find the sender by email
  const sender = await prisma.user.findUnique({
    where: { email: from },
  });

  if (!sender) {
    await sendBounce(from, "This email address is not registered on PartsPort.");
    return { error: "Sender not found" };
  }

  // Find the thread
  let thread: any = null;
  if (kind === "order") {
    thread = await prisma.order.findUnique({
      where: { id },
      include: { items: { include: { product: { include: { supplier: true } } } } },
    });
  } else if (kind === "quote") {
    thread = await prisma.quoteRequest.findUnique({
      where: { id },
      include: { product: { include: { supplier: true } } },
    });
  }

  if (!thread) {
    await sendBounce(from, "The thread for this reply no longer exists.");
    return { error: "Thread not found" };
  }

  // Verify sender has access to this thread
  let hasAccess = false;
  if (kind === "order") {
    const isBuyer = !!thread.buyerId && sender.id === thread.buyerId;
    const isAdmin = sender.role === "ADMIN";
    if (isBuyer || isAdmin) {
      hasAccess = true;
    } else if (sender.role === "SUPPLIER") {
      const { userHasAccessToSupplier } = await import("@/lib/supplier-access");
      const supplierIds = Array.from(
        new Set(thread.items.map((it: any) => it.product.supplierId))
      );
      const checks = await Promise.all(
        supplierIds.map((id: string) => userHasAccessToSupplier(sender.id, id))
      );
      hasAccess = checks.some((c: any) => c.ok);
    }
  } else if (kind === "quote") {
    const isBuyer = !!thread.buyerId && sender.id === thread.buyerId;
    const isAdmin = sender.role === "ADMIN";
    if (isBuyer || isAdmin) {
      hasAccess = true;
    } else if (sender.role === "SUPPLIER") {
      const { userHasAccessToSupplier } = await import("@/lib/supplier-access");
      const access = await userHasAccessToSupplier(sender.id, thread.product.supplierId);
      hasAccess = access.ok;
    }
  }

  if (!hasAccess) {
    await sendBounce(from, "You don't have access to this thread.");
    return { error: "Access denied" };
  }

  // Create the message
  const message = await prisma.message.create({
    data: {
      ...(kind === "order" ? { orderId: id } : { quoteId: id }),
      senderId: sender.id,
      senderName: sender.name,
      senderEmail: sender.email,
      senderRole: sender.role,
      body,
    },
  });

  // Send notifications to other participants
  const { sendThreadMessage } = await import("@/lib/email");
  const recipients = new Set<string>();
  const threadUrl = kind === "order" ? `/orders/${id}` : `/quotes/${id}`;

  if (kind === "order") {
    if (sender.id !== thread.buyerId) recipients.add(thread.buyerEmail);
    if (sender.role !== "SUPPLIER") {
      for (const it of thread.items) {
        recipients.add(it.product.supplier.contactEmail);
      }
    }
  } else {
    if (sender.id !== thread.buyerId) recipients.add(thread.buyerEmail);
    if (sender.role !== "SUPPLIER") {
      recipients.add(thread.product.supplier.contactEmail);
    }
  }

  for (const to of recipients) {
    sendThreadMessage({
      to,
      senderName: sender.name,
      subjectPrefix: kind === "order" ? `Order ${thread.reference}` : `RFQ ${thread.reference}`,
      context: kind === "order" ? `order ${thread.reference}` : `RFQ ${thread.reference} for ${thread.product?.name || "item"}`,
      body,
      threadUrl: `https://partsport.agentgaming.gg${threadUrl}`,
      ...(kind === "order" ? { orderId: id } : { quoteId: id }),
    }).catch((err: any) => console.error("[email] thread-message failed:", err));
  }

  return { ok: true, message };
}

export async function POST(req: Request) {
  const provider = process.env.INBOUND_EMAIL_PROVIDER;
  if (!provider) {
    return NextResponse.json(
      { error: "Inbound email not configured" },
      { status: 501 }
    );
  }

  try {
    const rawBody = await req.text();

    // Optional webhook signature verification
    if (!verifyWebhookSignature(rawBody)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let payload: any;
    const contentType = req.headers.get("content-type");

    if (contentType?.includes("application/json")) {
      payload = JSON.parse(rawBody);
    } else if (contentType?.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(rawBody);
      payload = Object.fromEntries(params);
    } else {
      return NextResponse.json({ error: "Unsupported content type" }, { status: 400 });
    }

    // Route to appropriate handler
    let result;
    if (provider === "resend") {
      result = await handleResendInbound(payload);
    } else if (provider === "postmark") {
      // Postmark format: FromFull, TextBody, HtmlBody, MessageStream, etc.
      result = await handleResendInbound({
        from: payload.FromFull?.Email || payload.From,
        text: payload.TextBody,
        html: payload.HtmlBody,
        to: payload.ToFull?.[0]?.Email || payload.To,
        subject: payload.Subject,
      });
    } else if (provider === "sendgrid") {
      // SendGrid Inbound Parse format
      result = await handleResendInbound({
        from: payload.from,
        text: payload.text,
        html: payload.html,
        to: payload.to,
        subject: payload.subject,
      });
    } else {
      return NextResponse.json(
        { error: `Unknown provider: ${provider}` },
        { status: 400 }
      );
    }

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[inbound] webhook failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

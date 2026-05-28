import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendThreadMessage } from "@/lib/email";
import { siteUrl } from "@/lib/site-url";
import { captureError } from "@/lib/observability";
import {
  canSendMessages,
  resolveSupplierThreadRecipients,
  userHasAccessToSupplier,
} from "@/lib/supplier-access";
import { rateLimit } from "@/lib/rate-limit";
import {
  emailsBuyer,
  emailsSupplierTeam,
  resolveOutgoingVisibility,
  type ViewerRole,
} from "@/lib/message-visibility";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const limit = await rateLimit("messages", `user:${user.id}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Slow down a moment, then try again." },
      { status: 429 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const orderId = body.orderId ? String(body.orderId) : "";
  const quoteId = body.quoteId ? String(body.quoteId) : "";
  const text = String(body.body || "").trim().slice(0, 4000);
  const requestedVisibility = body.visibility;

  if (!text) {
    return NextResponse.json({ error: "Message body is required." }, { status: 400 });
  }
  if ((!orderId && !quoteId) || (orderId && quoteId)) {
    return NextResponse.json(
      { error: "Exactly one of orderId or quoteId is required." },
      { status: 400 }
    );
  }

  const recipients = new Set<string>();
  const recipientUserIds = new Map<string, string | null>();
  let subjectPrefix = "";
  let threadUrl = "";
  let viewerRole: ViewerRole = "none";
  let visibility: ReturnType<typeof resolveOutgoingVisibility> = "PUBLIC";

  if (orderId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: { include: { supplier: true } } } } },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }
    const isBuyer = !!order.buyerId && user.id === order.buyerId;
    const isAdmin = user.role === "ADMIN";
    let isOrderSupplier = false;
    if (user.role === "SUPPLIER") {
      const supplierIds = Array.from(
        new Set(order.items.map((it) => it.product.supplierId))
      );
      const checks = await Promise.all(
        supplierIds.map((id) => userHasAccessToSupplier(user.id, id))
      );
      isOrderSupplier = checks.some((c) => c.ok && canSendMessages(c.role));
    }
    if (!isBuyer && !isAdmin && !isOrderSupplier) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }
    viewerRole = isAdmin ? "admin" : isOrderSupplier ? "supplier" : "buyer";
    visibility = resolveOutgoingVisibility(requestedVisibility, viewerRole);
    // Buyer message goes to each supplier email + admin (BCC bundled). Supplier
    // message goes to the buyer + admin. Admin message goes to both.
    if (!isBuyer && emailsBuyer(visibility)) {
      const k = order.buyerEmail.toLowerCase();
      recipients.add(k);
      recipientUserIds.set(k, order.buyerId || null);
    }
    if (!isOrderSupplier && emailsSupplierTeam(visibility)) {
      // PLH-3p F1: fan out to every supplier teammate with send-message
      // permission instead of only the supplier's single contactEmail.
      const supplierIds = Array.from(
        new Set(order.items.map((it) => it.product.supplierId))
      );
      for (const sid of supplierIds) {
        const fans = await resolveSupplierThreadRecipients(sid);
        for (const f of fans) {
          const key = f.email.toLowerCase();
          if (!key) continue;
          recipients.add(key);
          if (!recipientUserIds.has(key)) {
            recipientUserIds.set(key, f.userId);
          }
        }
      }
    }
    subjectPrefix = `Order ${order.reference}`;
    threadUrl = siteUrl(`/orders/${order.id}`);
  } else {
    const quote = await prisma.quoteRequest.findUnique({
      where: { id: quoteId },
      include: { product: { include: { supplier: true } } },
    });
    if (!quote) {
      return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    }
    const isBuyer = !!quote.buyerId && user.id === quote.buyerId;
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
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }
    viewerRole = isAdmin ? "admin" : isQuoteSupplier ? "supplier" : "buyer";
    visibility = resolveOutgoingVisibility(requestedVisibility, viewerRole);
    if (!isBuyer && emailsBuyer(visibility)) {
      const k = quote.buyerEmail.toLowerCase();
      recipients.add(k);
      recipientUserIds.set(k, quote.buyerId || null);
    }
    if (!isQuoteSupplier && emailsSupplierTeam(visibility)) {
      // PLH-3p F1: fan out to every supplier teammate with send-message
      // permission instead of only the supplier's single contactEmail.
      const fans = await resolveSupplierThreadRecipients(
        quote.product.supplierId
      );
      for (const f of fans) {
        const key = f.email.toLowerCase();
        if (!key) continue;
        recipients.add(key);
        if (!recipientUserIds.has(key)) {
          recipientUserIds.set(key, f.userId);
        }
      }
    }
    subjectPrefix = `RFQ ${quote.reference}`;
    threadUrl = siteUrl(`/quotes/${quote.id}`);
  }

  const created = await prisma.message.create({
    data: {
      orderId: orderId || null,
      quoteId: quoteId || null,
      senderId: user.id,
      senderName: user.name,
      senderEmail: user.email,
      senderRole: user.role,
      body: text,
      visibility,
    },
  });

  // PLH-3p F1: never email the posting user themselves.
  recipients.delete(user.email.toLowerCase());

  const threadKind = orderId ? "order" : "quote";
  const threadId = orderId || quoteId;

  // PLH-3o: hand the most recent prior message on this thread to the
  // email lib so it can render a standard "On <Date>, <Name> wrote:"
  // quoted block under the new message. Single prior message only;
  // Gmail collapses deeper history on its own.
  const prevRow = await prisma.message.findFirst({
    where: orderId
      ? { orderId, NOT: { id: created.id } }
      : { quoteId, NOT: { id: created.id } },
    orderBy: { createdAt: "desc" },
    select: {
      senderName: true,
      senderEmail: true,
      body: true,
      createdAt: true,
    },
  });
  const prevMessage = prevRow
    ? {
        senderName: prevRow.senderName,
        senderEmail: prevRow.senderEmail,
        body: prevRow.body,
        createdAt: prevRow.createdAt,
      }
    : null;

  after(async () => {
    // PLH-3p F2: attachments are uploaded in a follow-up call from the
    // client AFTER POST /api/messages returns. Count them here inside the
    // after() block, which runs after the HTTP response, so the outbound
    // email's "N attachments" line is usually accurate. If the client is
    // still uploading when we send, the link in the email still works.
    const attachmentCount = await prisma.messageAttachment.count({
      where: { messageId: created.id },
    });
    for (const to of recipients) {
      try {
        await sendThreadMessage({
          to,
          senderName: user.name,
          subjectPrefix,
          body: text,
          threadUrl,
          threadKind,
          threadId,
          recipientUserId: recipientUserIds.get(to) ?? null,
          prevMessage,
          attachmentCount,
        });
      } catch (err) {
        captureError(err, { subsystem: "email", op: "thread-message", to });
      }
    }
  });

  // PLH-3p F2: hand back an empty attachments array so the client knows it
  // can immediately POST follow-up uploads to /api/messages/[id]/attachments.
  return NextResponse.json({
    ok: true,
    message: { ...created, attachments: [] },
  });
}

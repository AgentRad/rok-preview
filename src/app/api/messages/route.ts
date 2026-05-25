import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendThreadMessage } from "@/lib/email";
import { siteUrl } from "@/lib/site-url";
import {
  canSendMessages,
  userHasAccessToSupplier,
} from "@/lib/supplier-access";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const orderId = body.orderId ? String(body.orderId) : "";
  const quoteId = body.quoteId ? String(body.quoteId) : "";
  const text = String(body.body || "").trim().slice(0, 4000);

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
  let subjectPrefix = "";
  let context = "";
  let threadUrl = "";

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
    // Buyer message goes to each supplier email + admin (BCC bundled). Supplier
    // message goes to the buyer + admin. Admin message goes to both.
    if (!isBuyer) recipients.add(order.buyerEmail);
    if (!isOrderSupplier) {
      for (const it of order.items) recipients.add(it.product.supplier.contactEmail);
    }
    subjectPrefix = `Order ${order.reference}`;
    context = `your order ${order.reference}`;
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
    if (!isBuyer) recipients.add(quote.buyerEmail);
    if (!isQuoteSupplier) recipients.add(quote.product.supplier.contactEmail);
    subjectPrefix = `RFQ ${quote.reference}`;
    context = `RFQ ${quote.reference} for ${quote.product.name}`;
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
    },
  });

  const threadKind = orderId ? "order" : "quote";
  const threadId = orderId || quoteId;
  for (const to of recipients) {
    sendThreadMessage({
      to,
      senderName: user.name,
      subjectPrefix,
      context,
      body: text,
      threadUrl,
      threadKind,
      threadId,
    }).catch((err) => console.error("[email] thread-message failed:", err));
  }

  return NextResponse.json({ ok: true, message: created });
}

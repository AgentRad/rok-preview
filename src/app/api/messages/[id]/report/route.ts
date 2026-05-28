import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import {
  canSendMessages,
  userHasAccessToSupplier,
} from "@/lib/supplier-access";
import {
  visibilitiesVisibleTo,
  type ViewerRole,
} from "@/lib/message-visibility";

export const runtime = "nodejs";

const REASONS = ["Spam", "Abusive", "Off-topic", "Other"];

/**
 * PLH-3w P3: a thread participant flags a message for admin review. The
 * reporter must have access to the thread (same membership + visibility
 * check the attachments route uses). Idempotent: re-reporting an already
 * pending message is a no-op 200.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const rl = await rateLimit("generic", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = REASONS.includes(String(body.reason)) ? String(body.reason) : "Other";
  const detail = String(body.detail || "").trim().slice(0, 500);

  const message = await prisma.message.findUnique({
    where: { id },
    include: {
      order: {
        include: {
          items: { include: { product: { select: { supplierId: true } } } },
        },
      },
      quote: { include: { product: { select: { supplierId: true } } } },
      directThread: { include: { participants: { select: { userId: true } } } },
    },
  });
  if (!message) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  const isAdmin = user.role === "ADMIN";
  let viewerRole: ViewerRole = "none";

  if (message.orderId && message.order) {
    const order = message.order;
    const isBuyer = !!order.buyerId && order.buyerId === user.id;
    let isOrderSupplier = false;
    if (user.role === "SUPPLIER") {
      const supplierIds = Array.from(
        new Set(order.items.map((it) => it.product.supplierId))
      );
      const checks = await Promise.all(
        supplierIds.map((sid) => userHasAccessToSupplier(user.id, sid))
      );
      isOrderSupplier = checks.some((c) => c.ok && canSendMessages(c.role));
    }
    if (!isBuyer && !isAdmin && !isOrderSupplier) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }
    viewerRole = isAdmin ? "admin" : isOrderSupplier ? "supplier" : "buyer";
  } else if (message.quoteId && message.quote) {
    const quote = message.quote;
    const isBuyer = !!quote.buyerId && quote.buyerId === user.id;
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
  } else if (message.directThreadId && message.directThread) {
    const onThread = message.directThread.participants.some(
      (p) => p.userId === user.id
    );
    if (!onThread && !isAdmin) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }
    viewerRole = isAdmin
      ? "admin"
      : user.role === "SUPPLIER"
        ? "supplier"
        : "buyer";
  } else {
    return NextResponse.json({ error: "Message thread not found." }, { status: 404 });
  }

  const allowed = visibilitiesVisibleTo(viewerRole);
  if (!allowed.includes(message.visibility)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  // Idempotent: already-pending report stands.
  if (message.reportedAt && !message.reviewedAt) {
    return NextResponse.json({ ok: true, alreadyReported: true });
  }

  const storedReason = detail ? `${reason}: ${detail}` : reason;
  await prisma.message.update({
    where: { id },
    data: {
      reportedAt: new Date(),
      reportedByUserId: user.id,
      reportReason: storedReason,
      // Clear any prior review so it re-enters the queue.
      reviewedAt: null,
      reviewedByUserId: null,
    },
  });
  await writeAuditLog({
    actor: user,
    action: "MESSAGE_REPORTED",
    targetType: "Message",
    targetId: id,
    summary: `Reported message as ${reason}.`,
    metadata: { reason, detail: detail || null, senderId: message.senderId },
  });

  return NextResponse.json({ ok: true });
}

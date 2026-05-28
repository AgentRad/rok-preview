import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canSendMessages,
  userHasAccessToSupplier,
} from "@/lib/supplier-access";
import { markThreadRead } from "@/lib/messages";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// PLH-3p F4: PATCH /api/messages/mark-read
// Body: { threadKind: "order" | "quote", threadId: string }
// Auth: same access check as the thread itself (buyer, admin, or supplier
// member with canSendMessages). Upserts ThreadLastRead.lastReadAt = now.
export async function PATCH(req: Request) {
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
  const threadKind = body?.threadKind;
  const threadId =
    typeof body?.threadId === "string" ? body.threadId.trim() : "";
  if ((threadKind !== "order" && threadKind !== "quote") || !threadId) {
    return NextResponse.json(
      { error: "threadKind and threadId are required." },
      { status: 400 }
    );
  }

  const isAdmin = user.role === "ADMIN";
  let authorized = isAdmin;

  if (threadKind === "order") {
    const order = await prisma.order.findUnique({
      where: { id: threadId },
      select: {
        buyerId: true,
        items: { select: { product: { select: { supplierId: true } } } },
      },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }
    if (!authorized && order.buyerId && order.buyerId === user.id) {
      authorized = true;
    }
    if (!authorized && user.role === "SUPPLIER") {
      const supplierIds = Array.from(
        new Set(order.items.map((it) => it.product.supplierId))
      );
      const checks = await Promise.all(
        supplierIds.map((id) => userHasAccessToSupplier(user.id, id))
      );
      authorized = checks.some((c) => c.ok && canSendMessages(c.role));
    }
  } else {
    const quote = await prisma.quoteRequest.findUnique({
      where: { id: threadId },
      select: {
        buyerId: true,
        product: { select: { supplierId: true } },
      },
    });
    if (!quote) {
      return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    }
    if (!authorized && quote.buyerId && quote.buyerId === user.id) {
      authorized = true;
    }
    if (!authorized && user.role === "SUPPLIER") {
      const access = await userHasAccessToSupplier(
        user.id,
        quote.product.supplierId
      );
      authorized = access.ok && canSendMessages(access.role);
    }
  }

  if (!authorized) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  await markThreadRead(user.id, threadKind, threadId);
  return NextResponse.json({ ok: true });
}

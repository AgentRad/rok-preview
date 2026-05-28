import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  visibilitiesVisibleTo,
  type MessageVisibility,
  type ViewerRole,
} from "@/lib/message-visibility";

export type ThreadKey = `order:${string}` | `quote:${string}`;

export type UnreadCounts = {
  orderUnread: number;
  quoteUnread: number;
  total: number;
  byThread: Map<ThreadKey, number>;
};

const EMPTY: UnreadCounts = {
  orderUnread: 0,
  quoteUnread: 0,
  total: 0,
  byThread: new Map(),
};

function viewerRoleForUser(role: string): ViewerRole {
  if (role === "ADMIN") return "admin";
  if (role === "BUYER") return "buyer";
  if (role === "SUPPLIER") return "supplier";
  return "none";
}

/**
 * PLH-3p F4: per-user unread counts across order + quote threads.
 *
 * - Excludes messages sent by the calling user.
 * - Honors PLH-3p F3 visibility: buyer reads PUBLIC + BUYER_INTERNAL,
 *   supplier reads PUBLIC + SUPPLIER_INTERNAL, admin reads all.
 * - Treats absence of a ThreadLastRead row as "all messages unread".
 *
 * Implementation: bounds the user's thread set first (orders/quotes the
 * user buys, sells, or admins), then a single Message.findMany filtered
 * by that set joined with ThreadLastRead in memory. Admin skips the
 * thread-set bound (sees everything).
 */
export async function getUnreadCounts(
  userId: string
): Promise<UnreadCounts> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!user) return EMPTY;
  const viewer = viewerRoleForUser(user.role);
  if (viewer === "none") return EMPTY;

  const allowed = visibilitiesVisibleTo(viewer) as MessageVisibility[];

  const messageWhere: Prisma.MessageWhereInput = {
    senderId: { not: userId },
    visibility: { in: allowed },
  };

  if (viewer !== "admin") {
    const supplierIds: string[] = [];
    if (viewer === "supplier") {
      const memberships = await prisma.supplierMember.findMany({
        where: { userId },
        select: { supplierId: true },
      });
      for (const m of memberships) supplierIds.push(m.supplierId);
      // Legacy single-owner supplier rows.
      const legacy = await prisma.supplier.findMany({
        where: { userId },
        select: { id: true },
      });
      for (const s of legacy) {
        if (!supplierIds.includes(s.id)) supplierIds.push(s.id);
      }
    }

    const threadOr: Prisma.MessageWhereInput[] = [];
    if (viewer === "buyer") {
      threadOr.push({ order: { buyerId: userId } });
      threadOr.push({ quote: { buyerId: userId } });
    } else if (viewer === "supplier") {
      if (supplierIds.length === 0) return EMPTY;
      threadOr.push({
        order: {
          items: { some: { product: { supplierId: { in: supplierIds } } } },
        },
      });
      threadOr.push({
        quote: { product: { supplierId: { in: supplierIds } } },
      });
    }
    if (threadOr.length === 0) return EMPTY;
    messageWhere.OR = threadOr;
  }

  const [messages, lastReads] = await Promise.all([
    prisma.message.findMany({
      where: messageWhere,
      select: { orderId: true, quoteId: true, createdAt: true },
    }),
    prisma.threadLastRead.findMany({
      where: { userId },
      select: { threadKind: true, threadId: true, lastReadAt: true },
    }),
  ]);

  const lastReadByKey = new Map<ThreadKey, Date>();
  for (const r of lastReads) {
    const key = `${r.threadKind}:${r.threadId}` as ThreadKey;
    lastReadByKey.set(key, r.lastReadAt);
  }

  const byThread = new Map<ThreadKey, number>();
  let orderUnread = 0;
  let quoteUnread = 0;
  for (const m of messages) {
    let key: ThreadKey | null = null;
    if (m.orderId) key = `order:${m.orderId}`;
    else if (m.quoteId) key = `quote:${m.quoteId}`;
    if (!key) continue;
    const last = lastReadByKey.get(key);
    if (last && m.createdAt <= last) continue;
    byThread.set(key, (byThread.get(key) ?? 0) + 1);
    if (m.orderId) orderUnread++;
    else quoteUnread++;
  }

  return {
    orderUnread,
    quoteUnread,
    total: orderUnread + quoteUnread,
    byThread,
  };
}

/** Upsert the read-pointer to now for (user, kind, threadId). */
export async function markThreadRead(
  userId: string,
  threadKind: "order" | "quote",
  threadId: string
): Promise<void> {
  const now = new Date();
  await prisma.threadLastRead.upsert({
    where: {
      userId_threadKind_threadId: { userId, threadKind, threadId },
    },
    create: { userId, threadKind, threadId, lastReadAt: now },
    update: { lastReadAt: now },
  });
}

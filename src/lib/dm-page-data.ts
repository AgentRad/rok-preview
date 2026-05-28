import "server-only";
import { prisma } from "@/lib/db";
import { getUnreadCounts } from "@/lib/messages";
import {
  visibilitiesVisibleTo,
  type MessageVisibility,
} from "@/lib/message-visibility";
import type {
  ThreadDetail,
  ThreadListItem,
} from "@/components/MessagesClient";
import type { ThreadMessage } from "@/components/MessageThread";

/** PLH-3q P4: server-side loaders for the /messages inbox + thread pages. */

export async function loadThreadList(
  userId: string
): Promise<ThreadListItem[]> {
  const [participations, counts] = await Promise.all([
    prisma.directMessageParticipant.findMany({
      where: { userId },
      select: {
        joinedAt: true,
        thread: {
          select: {
            id: true,
            subject: true,
            lastMessageAt: true,
            participants: {
              select: {
                userId: true,
                user: { select: { name: true, role: true } },
              },
            },
            messages: {
              where: { visibility: "PUBLIC" },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { body: true, createdAt: true },
            },
          },
        },
      },
      orderBy: { thread: { lastMessageAt: "desc" } },
      take: 50,
    }),
    getUnreadCounts(userId),
  ]);

  return participations.map((p) => {
    const last = p.thread.messages[0];
    const snippet = last
      ? last.body.replace(/\s+/g, " ").trim().slice(0, 120)
      : "";
    const unread = counts.byThread.get(`direct:${p.thread.id}`) ?? 0;
    return {
      id: p.thread.id,
      subject: p.thread.subject,
      lastMessageAt: p.thread.lastMessageAt.toISOString(),
      participants: p.thread.participants.map((pp) => ({
        userId: pp.userId,
        name: pp.user.name,
        role: pp.user.role,
      })),
      lastSnippet: snippet,
      unread,
    };
  });
}

export async function loadThreadDetail(
  userId: string,
  userRole: string,
  threadId: string
): Promise<{ thread: ThreadDetail; messages: ThreadMessage[] } | null> {
  const isAdmin = userRole === "ADMIN";
  const thread = await prisma.directMessageThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      subject: true,
      createdById: true,
      createdAt: true,
      lastMessageAt: true,
      participants: {
        select: {
          userId: true,
          joinedAt: true,
          addedByUserId: true,
          user: { select: { name: true, role: true, email: true } },
        },
      },
    },
  });
  if (!thread) return null;
  const me = thread.participants.find((p) => p.userId === userId);
  if (!me && !isAdmin) return null;
  const joinedAt = me?.joinedAt ?? new Date(0);
  const viewerRole =
    userRole === "ADMIN"
      ? "admin"
      : userRole === "SUPPLIER"
        ? "supplier"
        : userRole === "BUYER"
          ? "buyer"
          : "none";
  const allowed = visibilitiesVisibleTo(viewerRole) as MessageVisibility[];
  const messageRows = await prisma.message.findMany({
    where: {
      directThreadId: threadId,
      createdAt: { gte: joinedAt },
      visibility: { in: allowed },
    },
    orderBy: { createdAt: "asc" },
    include: {
      sender: { select: { name: true, role: true } },
      attachments: {
        select: {
          id: true,
          fileName: true,
          fileSize: true,
          mimeType: true,
          blobUrl: true,
        },
      },
    },
  });
  const messages: ThreadMessage[] = messageRows.map((m) => ({
    id: m.id,
    senderName: m.sender?.name ?? "Unknown",
    senderRole: m.sender?.role ?? "",
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    visibility: m.visibility as ThreadMessage["visibility"],
    attachments: m.attachments,
  }));
  return {
    thread: {
      id: thread.id,
      subject: thread.subject,
      createdById: thread.createdById,
      createdAt: thread.createdAt.toISOString(),
      lastMessageAt: thread.lastMessageAt.toISOString(),
      participants: thread.participants.map((p) => ({
        userId: p.userId,
        name: p.user.name,
        role: p.user.role,
        email: p.user.email,
        joinedAt: p.joinedAt.toISOString(),
        addedByUserId: p.addedByUserId,
      })),
    },
    messages,
  };
}

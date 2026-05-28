import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  visibilitiesVisibleTo,
  type MessageVisibility,
} from "@/lib/message-visibility";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;
  const thread = await prisma.directMessageThread.findUnique({
    where: { id },
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
          user: { select: { id: true, name: true, role: true, email: true } },
        },
      },
    },
  });
  if (!thread) {
    return NextResponse.json(
      { error: "Thread not found." },
      { status: 404 }
    );
  }
  const isAdmin = user.role === "ADMIN";
  const me = thread.participants.find((p) => p.userId === user.id);
  if (!me && !isAdmin) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const joinedAt = me?.joinedAt ?? new Date(0);
  const viewerRole =
    user.role === "ADMIN"
      ? "admin"
      : user.role === "SUPPLIER"
        ? "supplier"
        : user.role === "BUYER"
          ? "buyer"
          : "none";
  const allowed = visibilitiesVisibleTo(viewerRole) as MessageVisibility[];

  const messages = await prisma.message.findMany({
    where: {
      directThreadId: id,
      createdAt: { gte: joinedAt },
      visibility: { in: allowed },
    },
    orderBy: { createdAt: "asc" },
    include: {
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

  return NextResponse.json({
    ok: true,
    thread: {
      id: thread.id,
      subject: thread.subject,
      createdById: thread.createdById,
      createdAt: thread.createdAt,
      lastMessageAt: thread.lastMessageAt,
      participants: thread.participants.map((p) => ({
        userId: p.userId,
        name: p.user.name,
        role: p.user.role,
        email: p.user.email,
        joinedAt: p.joinedAt,
        addedByUserId: p.addedByUserId,
      })),
    },
    messages,
  });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canStartDirectMessage } from "@/lib/dm-permissions";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

const SUBJECT_MAX = 256;
const MAX_RECIPIENTS = 9;

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
  const subject = String(body?.subject || "").trim().slice(0, SUBJECT_MAX);
  if (!subject) {
    return NextResponse.json(
      { error: "Subject is required." },
      { status: 400 }
    );
  }
  const recipientUserIds: string[] = Array.isArray(body?.recipientUserIds)
    ? Array.from(
        new Set(
          body.recipientUserIds
            .map((x: unknown) => (typeof x === "string" ? x.trim() : ""))
            .filter((x: string) => x && x !== user.id)
        )
      )
    : [];
  if (recipientUserIds.length < 1 || recipientUserIds.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: `Pick 1 to ${MAX_RECIPIENTS} recipients.` },
      { status: 400 }
    );
  }

  for (const rid of recipientUserIds) {
    const ok = await canStartDirectMessage(user.id, rid);
    if (!ok) {
      return NextResponse.json(
        { error: "Not allowed to message this user.", userId: rid },
        { status: 403 }
      );
    }
  }

  const now = new Date();
  const thread = await prisma.$transaction(async (tx) => {
    const t = await tx.directMessageThread.create({
      data: {
        subject,
        createdById: user.id,
        createdAt: now,
        lastMessageAt: now,
      },
    });
    await tx.directMessageParticipant.createMany({
      data: [
        {
          threadId: t.id,
          userId: user.id,
          joinedAt: now,
          addedByUserId: user.id,
        },
        ...recipientUserIds.map((rid) => ({
          threadId: t.id,
          userId: rid,
          joinedAt: now,
          addedByUserId: user.id,
        })),
      ],
    });
    return t;
  });

  await writeAuditLog({
    actor: { id: user.id, email: user.email },
    action: "DM_THREAD_CREATED",
    targetType: "DirectMessageThread",
    targetId: thread.id,
    summary: `Direct message thread created with ${recipientUserIds.length} recipient(s)`,
    metadata: {
      subject,
      participantUserIds: [user.id, ...recipientUserIds],
    },
  });

  return NextResponse.json({ ok: true, thread });
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = 25;
  const participations = await prisma.directMessageParticipant.findMany({
    where: { userId: user.id },
    select: {
      threadId: true,
      joinedAt: true,
      thread: {
        select: {
          id: true,
          subject: true,
          createdById: true,
          createdAt: true,
          lastMessageAt: true,
          participants: {
            select: {
              userId: true,
              user: { select: { id: true, name: true, role: true } },
            },
          },
        },
      },
    },
    orderBy: { thread: { lastMessageAt: "desc" } },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return NextResponse.json({
    ok: true,
    page,
    pageSize,
    threads: participations.map((p) => ({
      id: p.thread.id,
      subject: p.thread.subject,
      createdById: p.thread.createdById,
      createdAt: p.thread.createdAt,
      lastMessageAt: p.thread.lastMessageAt,
      joinedAt: p.joinedAt,
      participants: p.thread.participants.map((pp) => ({
        userId: pp.userId,
        name: pp.user.name,
        role: pp.user.role,
      })),
    })),
  });
}

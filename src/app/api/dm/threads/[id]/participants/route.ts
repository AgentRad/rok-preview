import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAddParticipant } from "@/lib/dm-permissions";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

const MAX_PARTICIPANTS = 10;

export async function POST(
  req: Request,
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
  const body = await req.json().catch(() => ({}));
  const userIds: string[] = Array.isArray(body?.userIds)
    ? Array.from(
        new Set(
          body.userIds
            .map((x: unknown) => (typeof x === "string" ? x.trim() : ""))
            .filter((x: string) => !!x)
        )
      )
    : [];
  if (userIds.length === 0) {
    return NextResponse.json(
      { error: "userIds is required." },
      { status: 400 }
    );
  }

  const thread = await prisma.directMessageThread.findUnique({
    where: { id },
    select: {
      id: true,
      participants: { select: { userId: true } },
    },
  });
  if (!thread) {
    return NextResponse.json(
      { error: "Thread not found." },
      { status: 404 }
    );
  }
  const onThread = thread.participants.some((p) => p.userId === user.id);
  if (!onThread && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (
    thread.participants.length + userIds.length >
    MAX_PARTICIPANTS
  ) {
    return NextResponse.json(
      { error: `Threads are capped at ${MAX_PARTICIPANTS} participants.` },
      { status: 400 }
    );
  }

  for (const uid of userIds) {
    const ok = await canAddParticipant(user.id, id, uid);
    if (!ok) {
      return NextResponse.json(
        { error: "Not allowed to add this user.", userId: uid },
        { status: 403 }
      );
    }
  }

  const now = new Date();
  await prisma.directMessageParticipant.createMany({
    data: userIds.map((uid) => ({
      threadId: id,
      userId: uid,
      joinedAt: now,
      addedByUserId: user.id,
    })),
    skipDuplicates: true,
  });

  await writeAuditLog({
    actor: { id: user.id, email: user.email },
    action: "DM_PARTICIPANT_ADDED",
    targetType: "DirectMessageThread",
    targetId: id,
    summary: `Added ${userIds.length} participant(s) to direct message thread`,
    metadata: { addedUserIds: userIds },
  });

  return NextResponse.json({ ok: true, added: userIds.length });
}

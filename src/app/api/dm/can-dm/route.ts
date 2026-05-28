import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canStartDirectMessage } from "@/lib/dm-permissions";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

// PLH-3q P4: recipient search for the new-conversation + add-people modals.
// Returns at most 20 users matching the query whom the caller is permitted
// to DM. Permission gating runs through canStartDirectMessage so the same
// rules apply here as at POST /api/dm/threads.
export async function GET(req: Request) {
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
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
  if (q.length < 2) {
    return NextResponse.json({ ok: true, users: [] });
  }
  const candidates = await prisma.user.findMany({
    where: {
      deletedAt: null,
      id: { not: user.id },
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true, role: true },
    take: 30,
  });
  const allowed: { id: string; name: string; email: string; role: string }[] = [];
  for (const c of candidates) {
    if (allowed.length >= 20) break;
    const ok = await canStartDirectMessage(user.id, c.id);
    if (ok) allowed.push(c);
  }
  return NextResponse.json({ ok: true, users: allowed });
}

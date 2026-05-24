import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Admin-only review moderation. Suppliers cannot edit or delete reviews;
 * the only allowed change is admin "hide" with a reason (or "unhide").
 * Every moderation action is logged via the audit record (hiddenById +
 * hiddenAt + hiddenReason on the Review itself).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  const review = await prisma.review.findUnique({ where: { id } });
  if (!review) {
    return NextResponse.json({ error: "Review not found." }, { status: 404 });
  }

  if (action === "hide") {
    const reason = String(body.reason || "").trim().slice(0, 500);
    if (!reason) {
      return NextResponse.json(
        { error: "A moderation reason is required." },
        { status: 400 }
      );
    }
    await prisma.review.update({
      where: { id },
      data: {
        hiddenAt: new Date(),
        hiddenReason: reason,
        hiddenById: user.id,
      },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "unhide") {
    await prisma.review.update({
      where: { id },
      data: { hiddenAt: null, hiddenReason: "", hiddenById: null },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

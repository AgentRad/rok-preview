import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * PLH-3w P3: admin dismisses a reported message (no action against the
 * sender). Marks it reviewed so it leaves the pending queue. Suspending
 * the sender is handled via the P1 /admin/users flow, linked from the
 * queue, so this route only needs the dismiss path.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getCurrentUser();
  if (!admin || admin.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const rl = await rateLimit("generic", `user:${admin.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "").toLowerCase();

  if (action !== "dismiss") {
    return NextResponse.json({ error: "action must be dismiss." }, { status: 400 });
  }

  const message = await prisma.message.findUnique({
    where: { id },
    select: { id: true, reportedAt: true },
  });
  if (!message || !message.reportedAt) {
    return NextResponse.json({ error: "No pending report." }, { status: 404 });
  }

  await prisma.message.update({
    where: { id },
    data: { reviewedAt: new Date(), reviewedByUserId: admin.id },
  });
  await writeAuditLog({
    actor: admin,
    action: "MESSAGE_REPORT_DISMISSED",
    targetType: "Message",
    targetId: id,
    summary: "Dismissed reported message.",
    metadata: null,
  });
  return NextResponse.json({ ok: true });
}

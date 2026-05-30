import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { suspendUser, unsuspendUser, banUser } from "@/lib/user-status";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * PLH-3w P1: admin actions on a user account.
 *   action=suspend    requires reason (<=500). Reversible lockout.
 *   action=unsuspend   lifts a suspension.
 *   action=ban         requires reason. Terminal: status BANNED + email
 *                      blacklisted via BannedEmail.
 * All three live in src/lib/user-status.ts so the cascade (session kill,
 * supplier hide, OEM storefront 404) is shared.
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
  const reason = String(body.reason || "").trim();

  if (id === admin.id) {
    return NextResponse.json(
      { error: "You cannot change your own account status." },
      { status: 400 }
    );
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (action === "suspend") {
    if (!reason) {
      return NextResponse.json(
        { error: "A suspension reason is required." },
        { status: 400 }
      );
    }
    await suspendUser({ targetUserId: id, reason, admin });
    return NextResponse.json({ ok: true });
  }

  if (action === "unsuspend") {
    await unsuspendUser({ targetUserId: id, admin });
    return NextResponse.json({ ok: true });
  }

  if (action === "ban") {
    if (!reason) {
      return NextResponse.json(
        { error: "A ban reason is required." },
        { status: 400 }
      );
    }
    await banUser({ targetUserId: id, reason, admin });
    return NextResponse.json({ ok: true });
  }

  if (action === "2fa-recovery") {
    // PLH-3w P2: grant a 1-hour 2FA recovery override so a locked-out user
    // can sign in and re-enroll. Heavily audited (security-control bypass).
    const until = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.user.update({
      where: { id },
      data: { twoFactorRecoveryUntil: until },
    });
    await writeAuditLog({
      actor: admin,
      action: "USER_2FA_ADMIN_OVERRIDE",
      targetType: "User",
      targetId: id,
      summary: `Granted 1-hour 2FA recovery override (until ${until.toISOString()}).`,
      metadata: { until: until.toISOString(), reason: reason || null },
    });
    return NextResponse.json({ ok: true, until: until.toISOString() });
  }

  return NextResponse.json(
    { error: "action must be suspend, unsuspend, ban, or 2fa-recovery." },
    { status: 400 }
  );
}

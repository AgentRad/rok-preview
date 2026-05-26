import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  destroySession,
  getCurrentUser,
  verifyPassword,
} from "@/lib/auth";
import {
  issueAccountToken,
  TOKEN_TYPES,
} from "@/lib/account-tokens";
import { sendAccountDeletionScheduled } from "@/lib/email";
import { siteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

const GRACE_DAYS = 30;

/**
 * Soft-delete the signed-in account. Sets User.deletedAt = now, signs the
 * user out, and emails a 30-day recovery link to the current address.
 * PII is NOT anonymized at this stage; a future hard-delete cron handles
 * that after the grace period passes. The login route refuses sign-in
 * while deletedAt is set (with a hint about the recovery email).
 *
 * Requires the current password to confirm intent.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  if (user.deletedAt) {
    return NextResponse.json(
      { error: "This account is already scheduled for deletion." },
      { status: 400 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const password = String(body.password || "");
  if (!password) {
    return NextResponse.json(
      { error: "Confirm with your current password." },
      { status: 400 }
    );
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 400 }
    );
  }
  // Admins can't delete themselves through the UI; they could lock the
  // platform out of admin access. They can be deleted from the DB if
  // needed.
  if (user.role === "ADMIN") {
    return NextResponse.json(
      {
        error:
          "Admin accounts can't self-delete from the UI. Have another admin remove this account from the database.",
      },
      { status: 403 }
    );
  }
  // PLH-1: bump sessionsValidFrom so any other browser this user is signed
  // into can't keep acting on the soon-to-be-anonymized account. The
  // current browser's cookie is cleared via destroySession below.
  await prisma.user.update({
    where: { id: user.id },
    data: { deletedAt: new Date(), sessionsValidFrom: new Date() },
  });
  const raw = await issueAccountToken({
    userId: user.id,
    type: TOKEN_TYPES.ACCOUNT_RECOVERY,
    expiresInMs: GRACE_DAYS * 24 * 60 * 60 * 1000,
  });
  await sendAccountDeletionScheduled({
    to: user.email,
    name: user.name,
    graceDays: GRACE_DAYS,
    recoverUrl: siteUrl(`/api/account/recover?token=${raw}`),
  });
  await destroySession();
  return NextResponse.json({ ok: true, graceDays: GRACE_DAYS });
}

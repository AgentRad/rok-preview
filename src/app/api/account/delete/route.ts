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
import { rateLimit, clientIp } from "@/lib/rate-limit";

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
  const limit = await rateLimit("generic", clientIp(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }
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
  // PLH-1 commit 2: block self-delete when the buyer has open orders.
  // Schema has no deliveredAt; FULFILLED orders count as in-flight until
  // a future deliveredAt field separates them. PENDING + PAID + FULFILLED
  // are all "open" from a refund/dispute standpoint.
  const openOrders = await prisma.order.count({
    where: {
      buyerId: user.id,
      status: { in: ["PENDING", "PAID", "FULFILLED"] },
    },
  });
  if (openOrders > 0) {
    return NextResponse.json(
      {
        error: `You have ${openOrders} open order(s). Cancel or complete them, or contact support before deleting your account.`,
        openOrders,
      },
      { status: 400 }
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

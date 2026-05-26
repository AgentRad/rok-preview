import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, verifyPassword } from "@/lib/auth";
import {
  issueAccountToken,
  TOKEN_TYPES,
} from "@/lib/account-tokens";
import {
  sendEmailChangeConfirm,
  sendEmailChangeNotice,
} from "@/lib/email";
import { siteUrl } from "@/lib/site-url";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const EXPIRES_HOURS = 24;

/**
 * Start an email-change. The user supplies the new address + their
 * current password to confirm intent. We mail a confirmation link to the
 * NEW address; the swap doesn't happen until that link is clicked. Both
 * old and new addresses are notified at swap time so a hijacker can't
 * silently rotate the recovery vector.
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
  const body = await req.json().catch(() => ({}));
  const newEmail = String(body.newEmail || "").toLowerCase().trim();
  const password = String(body.password || "");
  if (!newEmail || !password) {
    return NextResponse.json(
      { error: "Provide the new email and your current password." },
      { status: 400 }
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) {
    return NextResponse.json(
      { error: "That doesn't look like a valid email." },
      { status: 400 }
    );
  }
  if (newEmail === user.email) {
    return NextResponse.json(
      { error: "The new email matches your current one." },
      { status: 400 }
    );
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 400 }
    );
  }
  const taken = await prisma.user.findUnique({ where: { email: newEmail } });
  if (taken) {
    return NextResponse.json(
      { error: "That email is already used by another account." },
      { status: 409 }
    );
  }

  const raw = await issueAccountToken({
    userId: user.id,
    type: TOKEN_TYPES.EMAIL_CHANGE,
    payload: { newEmail },
    expiresInMs: EXPIRES_HOURS * 60 * 60 * 1000,
  });
  const confirmUrl = siteUrl(`/api/account/email-change/confirm?token=${raw}`);
  await sendEmailChangeConfirm({
    to: newEmail,
    name: user.name,
    confirmUrl,
    expiresHours: EXPIRES_HOURS,
  });
  // Heads-up to the old address so the user notices unauthorized changes
  // immediately, before the swap happens.
  await sendEmailChangeNotice({
    to: user.email,
    name: user.name,
    oldEmail: user.email,
    newEmail,
  });
  return NextResponse.json({
    ok: true,
    sentTo: newEmail,
    expiresHours: EXPIRES_HOURS,
  });
}

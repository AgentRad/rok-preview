import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  consumeAccountToken,
  TOKEN_TYPES,
  hashToken,
} from "@/lib/account-tokens";
import { sendEmailChangeNotice } from "@/lib/email";
import { siteUrl } from "@/lib/site-url";
import { createSession, getCurrentUser, destroySession } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Click-through target for the email-change confirmation link.
 *
 * PLH-1 commit 2: session-fixation interstitial. If an existing session
 * belongs to a different user, route through /confirm-action first.
 */
async function handle(req: Request, method: "GET" | "POST") {
  const limit = await rateLimit("generic", clientIp(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  if (!token) {
    return NextResponse.redirect(siteUrl("/settings?emailChange=expired"), {
      status: 303,
    });
  }

  if (method === "GET") {
    const current = await getCurrentUser();
    if (current) {
      const owner = await prisma.accountToken.findUnique({
        where: { tokenHash: hashToken(token) },
        select: { userId: true, usedAt: true },
      });
      if (owner && !owner.usedAt && owner.userId !== current.id) {
        return NextResponse.redirect(
          siteUrl(
            `/confirm-action?action=email-change&token=${encodeURIComponent(token)}`
          ),
          { status: 303 }
        );
      }
    }
  }

  const row = await consumeAccountToken(token, TOKEN_TYPES.EMAIL_CHANGE);
  if (!row) {
    return NextResponse.redirect(siteUrl("/settings?emailChange=expired"), {
      status: 303,
    });
  }
  const payload = row.payload as { newEmail?: string } | null;
  const newEmail = payload?.newEmail;
  if (!newEmail) {
    return NextResponse.redirect(siteUrl("/settings?emailChange=invalid"), {
      status: 303,
    });
  }
  const taken = await prisma.user.findUnique({ where: { email: newEmail } });
  if (taken && taken.id !== row.userId) {
    return NextResponse.redirect(siteUrl("/settings?emailChange=taken"), {
      status: 303,
    });
  }
  const oldEmail = row.user.email;
  await prisma.user.update({
    where: { id: row.userId },
    data: {
      email: newEmail,
      emailVerified: new Date(),
      sessionsValidFrom: new Date(),
    },
  });
  await sendEmailChangeNotice({
    to: oldEmail,
    name: row.user.name,
    oldEmail,
    newEmail,
  });
  // Drop any old cookie + drop a fresh one tied to the bumped svf.
  await destroySession();
  await createSession(row.userId);
  return NextResponse.redirect(siteUrl("/settings?emailChange=done"), {
    status: 303,
  });
}

export async function GET(req: Request) {
  return handle(req, "GET");
}

export async function POST(req: Request) {
  return handle(req, "POST");
}

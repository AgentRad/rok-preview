import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, getCurrentUser, destroySession } from "@/lib/auth";
import {
  consumeAccountToken,
  TOKEN_TYPES,
  hashToken,
} from "@/lib/account-tokens";
import { siteUrl } from "@/lib/site-url";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Click-through target for the deletion-recovery link. Clears deletedAt
 * and signs the user in.
 *
 * PLH-1 commit 2: session-fixation interstitial. If an existing session
 * belongs to a different user, route through /confirm-action.
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
    return NextResponse.redirect(siteUrl("/login?recover=expired"), {
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
            `/confirm-action?action=recover&token=${encodeURIComponent(token)}`
          ),
          { status: 303 }
        );
      }
    }
  }

  const row = await consumeAccountToken(token, TOKEN_TYPES.ACCOUNT_RECOVERY);
  if (!row) {
    return NextResponse.redirect(siteUrl("/login?recover=expired"), {
      status: 303,
    });
  }
  // BUG (HIGH): re-check the account trust gate before recovering. Without this
  // a banned-and-deleted user could consume an ACCOUNT_RECOVERY token, clear
  // deletedAt, and mint an active session, bypassing the suspend/ban lock. The
  // token is already consumed above (so it cannot be replayed); reject with the
  // login route's generic 403 when the account is not ACTIVE.
  const recovering = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { status: true },
  });
  if (!recovering || recovering.status !== "ACTIVE") {
    return NextResponse.json(
      {
        error:
          "This account is not available. If you believe this is a mistake, contact support@partsport.com.",
      },
      { status: 403 }
    );
  }
  await prisma.user.update({
    where: { id: row.userId },
    data: { deletedAt: null },
  });
  await destroySession();
  await createSession(row.userId);
  return NextResponse.redirect(siteUrl("/account?recover=1"), { status: 303 });
}

export async function GET(req: Request) {
  return handle(req, "GET");
}

export async function POST(req: Request) {
  return handle(req, "POST");
}

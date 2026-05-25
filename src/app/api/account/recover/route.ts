import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import {
  consumeAccountToken,
  TOKEN_TYPES,
} from "@/lib/account-tokens";
import { siteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

/**
 * Click-through target for the recovery link mailed when an account was
 * scheduled for deletion. Clears deletedAt, signs the user in, and lands
 * them on /account with a confirmation banner.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const row = await consumeAccountToken(token, TOKEN_TYPES.ACCOUNT_RECOVERY);
  if (!row) {
    return NextResponse.redirect(siteUrl("/login?recover=expired"), {
      status: 303,
    });
  }
  await prisma.user.update({
    where: { id: row.userId },
    data: { deletedAt: null },
  });
  await createSession(row.userId);
  return NextResponse.redirect(siteUrl("/account?recover=1"), { status: 303 });
}

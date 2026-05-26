import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  consumeAccountToken,
  TOKEN_TYPES,
} from "@/lib/account-tokens";
import { sendEmailChangeNotice } from "@/lib/email";
import { siteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

/**
 * Click-through target for the email-change confirmation link. Swaps the
 * sign-in email to the new address and re-marks emailVerified so the new
 * address is trusted immediately (the user just proved they own it).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const row = await consumeAccountToken(token, TOKEN_TYPES.EMAIL_CHANGE);
  if (!row) {
    return NextResponse.redirect(
      siteUrl("/settings?emailChange=expired"),
      { status: 303 }
    );
  }
  const payload = row.payload as { newEmail?: string } | null;
  const newEmail = payload?.newEmail;
  if (!newEmail) {
    return NextResponse.redirect(
      siteUrl("/settings?emailChange=invalid"),
      { status: 303 }
    );
  }
  // Race-condition guard: if another account grabbed the address between
  // issuance and confirmation, bail out cleanly.
  const taken = await prisma.user.findUnique({ where: { email: newEmail } });
  if (taken && taken.id !== row.userId) {
    return NextResponse.redirect(
      siteUrl("/settings?emailChange=taken"),
      { status: 303 }
    );
  }
  const oldEmail = row.user.email;
  // PLH-1: bump sessionsValidFrom so sessions on devices the old email
  // still has access to get rejected on the next request.
  await prisma.user.update({
    where: { id: row.userId },
    data: {
      email: newEmail,
      emailVerified: new Date(),
      sessionsValidFrom: new Date(),
    },
  });
  // Belt-and-suspenders heads-up: the old address already got a
  // "change requested" email when /email-change started; this is the
  // "change completed" follow-up so a hijacker's window is narrow.
  await sendEmailChangeNotice({
    to: oldEmail,
    name: row.user.name,
    oldEmail,
    newEmail,
  });
  return NextResponse.redirect(siteUrl("/settings?emailChange=done"), {
    status: 303,
  });
}

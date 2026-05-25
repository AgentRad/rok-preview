import { NextResponse } from "next/server";
import { consumeEmailVerification } from "@/lib/email-verification";
import { createSession } from "@/lib/auth";
import { siteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

/**
 * Click-through verification target. Reads the token from the query string,
 * marks the user verified, signs them in if they weren't already, and
 * redirects to /account with a banner flag.
 *
 * Idempotency: once a token has been consumed it's cleared, so a second
 * GET with the same token returns "invalid or expired" rather than a
 * second session. That matches the email-link-clicked-twice flow.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const user = await consumeEmailVerification(token);
  if (!user) {
    return NextResponse.redirect(
      siteUrl("/account?verified=expired"),
      { status: 303 }
    );
  }
  await createSession(user.id);
  return NextResponse.redirect(siteUrl("/account?verified=1"), { status: 303 });
}

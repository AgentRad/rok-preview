import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { buildAuthorizeUrl, intuitConfigured } from "@/lib/qbo-auth";
import { siteUrl } from "@/lib/site-url";

/**
 * PLH-3i P1: admin-only kickoff for the Intuit OAuth consent flow.
 * Generates a CSRF state value, sets it as an httpOnly cookie, and
 * redirects to Intuit's authorize endpoint with the matching `state`
 * query parameter. The callback route compares the two.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (!intuitConfigured()) {
    return NextResponse.json(
      {
        error:
          "Intuit OAuth not configured. Set INTUIT_CLIENT_ID and INTUIT_CLIENT_SECRET.",
      },
      { status: 503 }
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = siteUrl("/api/admin/integrations/quickbooks/callback");
  const authorizeUrl = buildAuthorizeUrl({ state, redirectUri });

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set("pp_qbo_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}

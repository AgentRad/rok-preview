import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  getActiveBuyerOrgContext,
  canManageBuyerOrg,
} from "@/lib/buyer-org-access";
import { runSsoAction } from "@/lib/sso-actions";

export const runtime = "nodejs";

/**
 * PLH-3y-5: org-admin SSO actions, scoped to the caller's active org. Handles
 * SCIM token issue/disable and cert rotation stage/activate. The site-admin
 * parallel lives at /api/admin/buyer-orgs/[id]/sso/actions.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx || !canManageBuyerOrg(ctx.role)) {
    return NextResponse.json(
      { error: "Only an organization admin can manage SSO." },
      { status: 403 }
    );
  }
  const rl = await rateLimit("generic", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  return runSsoAction(ctx.org.id, user, body);
}

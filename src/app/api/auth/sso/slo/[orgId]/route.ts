import { NextResponse } from "next/server";
import { getCurrentUser, destroySession } from "@/lib/auth";
import { resolveSsoConfigByOrgId } from "@/lib/sso";
import { oidcEndSessionUrl } from "@/lib/oidc";
import { writeAuditLog } from "@/lib/audit";
import { siteUrl } from "@/lib/site-url";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * PLH-3y-5: Single Logout. Destroys the current PartsPort session and, when the
 * org's IdP advertises a logout endpoint (SAML idpSloUrl or OIDC
 * end_session_endpoint), best-effort redirects the browser there so the IdP
 * session is also torn down. We only ever destroy the caller's own session
 * cookie; we do not trust an unauthenticated request to invalidate others.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const limit = await rateLimit("login", clientIp(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429 }
    );
  }

  const user = await getCurrentUser();
  const config = await resolveSsoConfigByOrgId(orgId);

  await destroySession();

  if (user) {
    await writeAuditLog({
      actor: { id: user.id, email: user.email },
      action: "SSO_LOGOUT",
      targetType: "BuyerOrg",
      targetId: orgId,
      summary: `SSO single logout for ${user.email} from org ${orgId}.`,
      metadata: { orgId },
    });
  }

  let dest = siteUrl("/login?logout=1");
  if (config) {
    if (config.idpType === "OIDC") {
      const end = await oidcEndSessionUrl(config);
      if (end) dest = end;
    } else if (config.idpSloUrl) {
      dest = config.idpSloUrl;
    }
  }
  return NextResponse.redirect(dest, { status: 303 });
}

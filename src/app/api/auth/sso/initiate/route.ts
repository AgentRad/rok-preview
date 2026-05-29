import { NextResponse } from "next/server";
import {
  buildSaml,
  resolveSsoConfigByEmail,
  resolveSsoConfigByOrgId,
} from "@/lib/sso";
import {
  buildOidcAuthorizeUrl,
  OIDC_STATE_COOKIE,
  OIDC_STATE_COOKIE_MAX_AGE_SEC,
} from "@/lib/oidc";
import { writeAuditLog } from "@/lib/audit";
import { siteUrl } from "@/lib/site-url";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * PLH-3y-4: SSO entry point. Accepts ?email= (resolves the org by allowlisted
 * domain) or ?orgId= (direct). Builds a SAML AuthnRequest and 302s the browser
 * to the IdP's SSO URL. The IdP posts back to the org's ACS endpoint.
 */
export async function GET(req: Request) {
  const limit = await rateLimit("login", clientIp(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }
  const url = new URL(req.url);
  const email = url.searchParams.get("email") || "";
  const orgId = url.searchParams.get("orgId") || "";

  const config = orgId
    ? await resolveSsoConfigByOrgId(orgId)
    : email
      ? await resolveSsoConfigByEmail(email)
      : null;

  if (!config) {
    return NextResponse.redirect(siteUrl("/login?sso=unavailable"), {
      status: 303,
    });
  }

  // Route to the OIDC /authorize endpoint or the SAML AuthnRequest depending
  // on the org's configured IdP type.
  let redirectUrl: string;
  // Set for the OIDC branch only: bound to the initiating browser via cookie
  // so the callback can defend against login CSRF / session fixation.
  let oidcStateNonce: string | null = null;
  try {
    if (config.idpType === "OIDC") {
      if (!config.oidcIssuer || !config.oidcClientId) {
        throw new Error("OIDC not configured.");
      }
      const built = await buildOidcAuthorizeUrl(config);
      redirectUrl = built.url;
      oidcStateNonce = built.nonce;
    } else {
      if (!config.idpSsoUrl || !config.idpEntityId) {
        throw new Error("SAML not configured.");
      }
      const saml = buildSaml(config, { requireCert: true });
      redirectUrl = await saml.getAuthorizeUrlAsync("", undefined, {});
    }
  } catch {
    return NextResponse.redirect(siteUrl("/login?sso=unavailable"), {
      status: 303,
    });
  }

  // BUG 2 (LOW): this endpoint is unauthenticated, so the supplied ?email= is
  // attacker-controlled. Logging it as the audit ACTOR let anyone spray
  // arbitrary identities into the audit trail. Log a fixed system actor and
  // keep the supplied email in metadata only, clearly labeled as untrusted.
  await writeAuditLog({
    actor: { id: "system", email: "sso-initiate" },
    action: "SSO_INITIATED",
    targetType: "BuyerOrg",
    targetId: config.buyerOrgId,
    summary: `SSO login initiated for org ${config.buyerOrgId} (${config.idpType}).`,
    metadata: {
      suppliedEmail: email || null,
      orgId: config.buyerOrgId,
      idpType: config.idpType,
    },
  });

  const res = NextResponse.redirect(redirectUrl, { status: 303 });
  // BUG 1 (MEDIUM): bind the OIDC flow to this browser. The callback requires
  // this cookie to match the nonce in the signed state before minting a
  // session, defeating OIDC login CSRF / session fixation.
  if (oidcStateNonce) {
    res.cookies.set(OIDC_STATE_COOKIE, oidcStateNonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: OIDC_STATE_COOKIE_MAX_AGE_SEC,
    });
  }
  return res;
}

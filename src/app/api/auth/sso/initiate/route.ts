import { NextResponse } from "next/server";
import {
  buildSaml,
  resolveSsoConfigByEmail,
  resolveSsoConfigByOrgId,
} from "@/lib/sso";
import { buildOidcAuthorizeUrl } from "@/lib/oidc";
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
  try {
    if (config.idpType === "OIDC") {
      if (!config.oidcIssuer || !config.oidcClientId) {
        throw new Error("OIDC not configured.");
      }
      redirectUrl = await buildOidcAuthorizeUrl(config);
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

  await writeAuditLog({
    actor: { id: config.configuredById || "system", email: email || "sso" },
    action: "SSO_INITIATED",
    targetType: "BuyerOrg",
    targetId: config.buyerOrgId,
    summary: `SAML AuthnRequest initiated for org ${config.buyerOrgId}.`,
    metadata: { email: email || null },
  });

  return NextResponse.redirect(redirectUrl, { status: 303 });
}

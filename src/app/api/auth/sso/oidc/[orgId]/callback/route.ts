import { NextResponse } from "next/server";
import {
  pickRole,
  provisionResolvedSsoUser,
  recordSsoEvent,
  resolveSsoConfigByOrgId,
  ssoSessionMaxAgeSec,
} from "@/lib/sso";
import { exchangeOidcCode, verifyOidcState } from "@/lib/oidc";
import { emailDomain } from "@/lib/free-email-domains";
import { createSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { siteUrl } from "@/lib/site-url";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

function fail(reason: string) {
  return NextResponse.redirect(siteUrl(`/login?sso_error=${reason}`), {
    status: 303,
  });
}

/**
 * PLH-3y-5: OIDC Authorization Code callback. The IdP redirects here with a
 * `code` + `state`. We validate the signed state (orgId + nonce), exchange the
 * code, verify the ID token signature against the IdP JWKS (iss / aud / exp /
 * nonce), enforce the domain allowlist, JIT-provision through the same path as
 * SAML, and open a session capped by the org's sessionMaxAgeMin. Every outcome
 * is recorded in SsoLoginEvent.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;

  const limit = await rateLimit("login", clientIp(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const idpError = url.searchParams.get("error");
  if (idpError) return fail("oidc_idp_error");
  if (!code || !state) return fail("badrequest");

  const stateData = await verifyOidcState(state);
  // The signed state binds the callback to the org that started the flow; a
  // mismatch with the path orgId means a tampered or cross-org redirect.
  if (!stateData || stateData.org !== orgId) return fail("badrequest");

  const config = await resolveSsoConfigByOrgId(orgId);
  if (!config || config.idpType !== "OIDC") return fail("unavailable");

  let claims;
  try {
    claims = await exchangeOidcCode({
      config,
      code,
      nonce: stateData.nonce,
    });
  } catch {
    await recordSsoEvent({
      buyerOrgId: orgId,
      email: "unknown",
      outcome: "FAILED_SIG",
      req,
    });
    return fail("failed_sig");
  }

  const email = claims.email.toLowerCase().trim();
  const domain = emailDomain(email);
  if (!email || !domain) {
    await recordSsoEvent({
      buyerOrgId: orgId,
      email: email || "unknown",
      outcome: "FAILED_DOMAIN",
      req,
    });
    return fail("failed_domain");
  }

  const allow = config.domainAllowlist.map((d) => d.toLowerCase());
  if (allow.length > 0 && !allow.includes(domain)) {
    await recordSsoEvent({
      buyerOrgId: orgId,
      email,
      outcome: "FAILED_DOMAIN",
      req,
    });
    return fail("failed_domain");
  }

  const role = pickRole(claims.groups, config);
  const { userId, provisioned } = await provisionResolvedSsoUser({
    config,
    email,
    role,
    name: claims.name || email.split("@")[0],
    groups: claims.groups,
  });

  await recordSsoEvent({
    buyerOrgId: orgId,
    userId,
    email,
    outcome: "SUCCESS",
    req,
  });
  await writeAuditLog({
    actor: { id: userId, email },
    action: "SSO_LOGIN_SUCCESS",
    targetType: "BuyerOrg",
    targetId: orgId,
    summary: `OIDC login success for ${email} as ${role}${
      provisioned ? " (JIT-provisioned)" : ""
    }.`,
    metadata: { role, provisioned, idp: "oidc" },
  });

  const maxAgeSec = ssoSessionMaxAgeSec(config);
  await createSession(userId, { sso: true, org: orgId, maxAgeSec });
  return NextResponse.redirect(siteUrl("/buyer-org"), { status: 303 });
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  pickRole,
  provisionResolvedSsoUser,
  recordSsoEvent,
  resolveSsoConfigByOrgId,
  ssoSessionMaxAgeSec,
} from "@/lib/sso";
import {
  exchangeOidcCode,
  verifyOidcState,
  OIDC_STATE_COOKIE,
} from "@/lib/oidc";
import { stateNonceMatches } from "@/lib/route-guards";
import { emailDomain } from "@/lib/free-email-domains";
import { createSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { siteUrl } from "@/lib/site-url";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Clear the browser-binding cookie on every exit (success or failure) so a
// stale nonce can't be reused on a later flow.
function clearStateCookie(res: NextResponse): NextResponse {
  res.cookies.set(OIDC_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

function fail(reason: string) {
  return clearStateCookie(
    NextResponse.redirect(siteUrl(`/login?sso_error=${reason}`), {
      status: 303,
    })
  );
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

  // BUG 1 (MEDIUM): bind the callback to the browser that initiated the flow.
  // The signed state proves the IdP round-trip is intact, but NOT that this
  // browser started it. /api/auth/sso/initiate set an HttpOnly cookie holding
  // the state nonce; require it to be present and to match the nonce in the
  // signed state. A missing/mismatched cookie means the callback URL was fed to
  // a victim (OIDC login CSRF / session fixation): reject, mint no session.
  const cookieStore = await cookies();
  const cookieNonce = cookieStore.get(OIDC_STATE_COOKIE)?.value || "";
  if (!stateNonceMatches(cookieNonce, stateData.nonce)) {
    await recordSsoEvent({
      buyerOrgId: orgId,
      email: "unknown",
      outcome: "FAILED_SIG",
      req,
    });
    return fail("badrequest");
  }

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
  return clearStateCookie(
    NextResponse.redirect(siteUrl("/buyer-org"), { status: 303 })
  );
}

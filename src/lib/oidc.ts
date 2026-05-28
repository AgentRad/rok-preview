import "server-only";
import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import type { SsoConfig } from "@prisma/client";
import { getSessionSecret } from "./auth";
import { siteUrl } from "./site-url";

// PLH-3y-5: generic OIDC (Authorization Code flow). Works with Google
// Workspace, Okta OIDC, and Azure AD OIDC: no vendor-specific code. The
// security-critical step (ID token signature verification against the IdP
// JWKS, plus iss / aud / exp / nonce validation) is delegated to `jose`. We
// never hand-roll JWT signature checking. The authorization-code exchange
// itself is a plain OAuth2 token POST (no crypto), so a fetch is appropriate.

export type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
};

/** The OIDC redirect/callback URL we register with the IdP, per org. */
export function oidcCallbackUrl(orgId: string): string {
  return siteUrl(`/api/auth/sso/oidc/${orgId}/callback`);
}

const _discoveryCache = new Map<string, { at: number; doc: OidcDiscovery }>();
const _jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const DISCOVERY_TTL_MS = 10 * 60_000;

/**
 * Fetch (and cache) the IdP's OpenID discovery document. `issuer` is the
 * configured issuer URL; the well-known path is appended unless the issuer
 * already points at a configuration document.
 */
export async function fetchDiscovery(issuer: string): Promise<OidcDiscovery> {
  const base = issuer.replace(/\/+$/, "");
  const cached = _discoveryCache.get(base);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.doc;

  const url = base.endsWith("/.well-known/openid-configuration")
    ? base
    : `${base}/.well-known/openid-configuration`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (${res.status}) for ${base}.`);
  }
  const doc = (await res.json()) as OidcDiscovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error("OIDC discovery document is missing required endpoints.");
  }
  _discoveryCache.set(base, { at: Date.now(), doc });
  return doc;
}

function jwks(jwksUri: string) {
  let set = _jwksCache.get(jwksUri);
  if (!set) {
    set = createRemoteJWKSet(new URL(jwksUri));
    _jwksCache.set(jwksUri, set);
  }
  return set;
}

/**
 * Signed, short-lived state token. Carries the orgId + a nonce so the callback
 * can validate the round-trip without server-side session storage. Signed with
 * the same HS256 secret as the auth session cookie.
 */
export async function buildOidcState(orgId: string): Promise<{
  state: string;
  nonce: string;
}> {
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = await new SignJWT({ org: orgId, nonce, k: "oidc-state" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(getSessionSecret());
  return { state, nonce };
}

export async function verifyOidcState(
  token: string
): Promise<{ org: string; nonce: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    if (payload.k !== "oidc-state") return null;
    const org = typeof payload.org === "string" ? payload.org : "";
    const nonce = typeof payload.nonce === "string" ? payload.nonce : "";
    if (!org || !nonce) return null;
    return { org, nonce };
  } catch {
    return null;
  }
}

/** Build the IdP /authorize redirect URL for an org. */
export async function buildOidcAuthorizeUrl(
  config: Pick<SsoConfig, "buyerOrgId" | "oidcIssuer" | "oidcClientId">
): Promise<string> {
  if (!config.oidcIssuer || !config.oidcClientId) {
    throw new Error("OIDC is not fully configured for this organization.");
  }
  const disco = await fetchDiscovery(config.oidcIssuer);
  const { state, nonce } = await buildOidcState(config.buyerOrgId);
  const url = new URL(disco.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.oidcClientId);
  url.searchParams.set("redirect_uri", oidcCallbackUrl(config.buyerOrgId));
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  return url.toString();
}

export type OidcClaims = {
  email: string;
  name?: string;
  groups: string[];
  raw: Record<string, unknown>;
};

/**
 * Exchange the authorization code for tokens, verify the ID token signature
 * against the IdP JWKS, and validate iss / aud / exp / nonce. Returns the
 * trusted claims, or throws on any failure (caller logs FAILED_SIG).
 */
export async function exchangeOidcCode(args: {
  config: SsoConfig;
  code: string;
  nonce: string;
}): Promise<OidcClaims> {
  const { config, code, nonce } = args;
  if (!config.oidcIssuer || !config.oidcClientId || !config.oidcClientSecret) {
    throw new Error("OIDC is not fully configured.");
  }
  const disco = await fetchDiscovery(config.oidcIssuer);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: oidcCallbackUrl(config.buyerOrgId),
    client_id: config.oidcClientId,
    client_secret: config.oidcClientSecret,
  });
  const tokenRes = await fetch(disco.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });
  if (!tokenRes.ok) {
    throw new Error(`OIDC token exchange failed (${tokenRes.status}).`);
  }
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) {
    throw new Error("OIDC token response did not include an id_token.");
  }

  // Security-critical: verify signature + standard claims via jose.
  const { payload } = await jwtVerify(tokens.id_token, jwks(disco.jwks_uri), {
    issuer: disco.issuer,
    audience: config.oidcClientId,
  });

  // Nonce binding: the ID token must echo the nonce we signed into state.
  if (payload.nonce !== nonce) {
    throw new Error("OIDC nonce mismatch.");
  }

  const email = String(payload.email || "").toLowerCase().trim();
  if (!email) throw new Error("OIDC id_token has no email claim.");

  const name =
    (typeof payload.name === "string" && payload.name) ||
    [payload.given_name, payload.family_name]
      .filter((v) => typeof v === "string" && v)
      .join(" ")
      .trim() ||
    undefined;

  const groups = extractOidcGroups(payload);
  return { email, name, groups, raw: payload as Record<string, unknown> };
}

const OIDC_GROUP_CLAIMS = ["groups", "roles", "memberOf"];

function extractOidcGroups(payload: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of OIDC_GROUP_CLAIMS) {
    const raw = payload[key];
    if (raw == null) continue;
    if (Array.isArray(raw)) out.push(...raw.map((v) => String(v)));
    else out.push(String(raw));
  }
  return out.map((g) => g.trim()).filter(Boolean);
}

/** Best-effort IdP end-session URL for SLO. Null when not advertised. */
export async function oidcEndSessionUrl(
  config: Pick<SsoConfig, "oidcIssuer">
): Promise<string | null> {
  if (!config.oidcIssuer) return null;
  try {
    const disco = await fetchDiscovery(config.oidcIssuer);
    return disco.end_session_endpoint || null;
  } catch {
    return null;
  }
}

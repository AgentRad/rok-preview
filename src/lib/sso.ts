import "server-only";
import crypto from "node:crypto";
import { SAML } from "@node-saml/node-saml";
import type { BuyerOrgRole, SsoConfig } from "@prisma/client";
import { prisma } from "./db";
import { writeAuditLog } from "./audit";
import { emailDomain } from "./free-email-domains";
import { autoJoinByEmailDomain } from "./buyer-org-access";
import { siteUrl } from "./site-url";

// PLH-3y-4: SAML 2.0 SSO + JIT provisioning. All XML signature verification,
// assertion validation (NotBefore / NotOnOrAfter / audience), and
// canonicalization are delegated to @node-saml/node-saml. We never hand-roll
// the crypto: node-saml throws on any invalid assertion and we classify the
// failure for the SsoLoginEvent audit trail.

// SsoLoginEvent.outcome values.
export type SsoOutcome =
  | "SUCCESS"
  | "FAILED_SIG"
  | "FAILED_NOTAFTER"
  | "FAILED_DOMAIN"
  | "FAILED_AUDIENCE";

// Default SAML attribute names that carry group membership. The IdP admin can
// override via SsoConfig.groupAttributeName.
const DEFAULT_GROUP_ATTRS = [
  "http://schemas.xmlsoap.org/claims/Group",
  "memberOf",
  "groups",
];

const ROLE_PRIORITY: Record<BuyerOrgRole, number> = {
  ADMIN: 3,
  APPROVER: 2,
  BUYER: 1,
  VIEWER: 0,
};

/** Our SP EntityID for an org: the metadata URL (stable, unique per org). */
export function spEntityId(orgId: string): string {
  return siteUrl(`/api/auth/sso/saml/${orgId}/metadata`);
}

/** Assertion Consumer Service URL the IdP POSTs the SAMLResponse to. */
export function acsUrl(orgId: string): string {
  return siteUrl(`/api/auth/sso/saml/${orgId}/acs`);
}

/**
 * Build a configured node-saml instance for an org. `requireCert` is true on
 * the login paths (we must verify signatures) and false for metadata-only
 * generation (the SP metadata does not need the IdP cert).
 */
export function buildSaml(
  config: Pick<
    SsoConfig,
    | "buyerOrgId"
    | "idpEntityId"
    | "idpSsoUrl"
    | "idpSloUrl"
    | "idpX509Cert"
    | "idpX509CertNext"
  >,
  opts: { requireCert?: boolean } = {}
): SAML {
  const certs = [config.idpX509Cert, config.idpX509CertNext]
    .map((c) => (c || "").trim())
    .filter(Boolean);
  if (opts.requireCert && certs.length === 0) {
    throw new Error("SSO is not fully configured: missing IdP signing cert.");
  }
  const orgId = config.buyerOrgId;
  return new SAML({
    // Accept either the current or the staged-next cert so a cert rotation is
    // zero-downtime: the org stages the new cert, the IdP flips, then the org
    // promotes it.
    idpCert: certs.length ? certs : "placeholder",
    entryPoint: config.idpSsoUrl || "https://invalid.invalid/sso",
    logoutUrl: config.idpSloUrl || undefined,
    issuer: spEntityId(orgId),
    callbackUrl: acsUrl(orgId),
    audience: spEntityId(orgId),
    idpIssuer: config.idpEntityId || undefined,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    identifierFormat:
      "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    acceptedClockSkewMs: 5000,
    disableRequestedAuthnContext: true,
  });
}

/** Serve SP metadata XML so an IdP admin can configure us in one paste. */
export function generateSpMetadata(orgId: string, config: SsoConfig | null): string {
  const saml = buildSaml(
    config ?? {
      buyerOrgId: orgId,
      idpEntityId: null,
      idpSsoUrl: null,
      idpSloUrl: null,
      idpX509Cert: null,
      idpX509CertNext: null,
    },
    { requireCert: false }
  );
  return saml.generateServiceProviderMetadata(null, null);
}

export async function resolveSsoConfigByOrgId(
  orgId: string
): Promise<SsoConfig | null> {
  return prisma.ssoConfig.findUnique({ where: { buyerOrgId: orgId } });
}

/**
 * Resolve an org's SSO config from an email by matching the lowercased domain
 * against domainAllowlist. Returns the first config whose allowlist contains
 * the domain.
 */
export async function resolveSsoConfigByEmail(
  email: string
): Promise<SsoConfig | null> {
  const domain = emailDomain(email);
  if (!domain) return null;
  return prisma.ssoConfig.findFirst({
    where: { domainAllowlist: { has: domain } },
  });
}

/**
 * Domain-lock check for the password-login path. Returns the enforcing config
 * when the email's domain is in an `enforced` SSO allowlist, else null. The
 * caller decides whether to honor a break-glass exception.
 */
export async function findEnforcedSsoForEmail(
  email: string
): Promise<SsoConfig | null> {
  const domain = emailDomain(email);
  if (!domain) return null;
  return prisma.ssoConfig.findFirst({
    where: { enforced: true, domainAllowlist: { has: domain } },
  });
}

/** Map a node-saml validation error to an SsoLoginEvent outcome. */
export function classifySamlError(err: unknown): SsoOutcome {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes("audience")) return "FAILED_AUDIENCE";
  if (
    msg.includes("notonorafter") ||
    msg.includes("notbefore") ||
    msg.includes("expired") ||
    msg.includes("stale") ||
    msg.includes("timestamp")
  ) {
    return "FAILED_NOTAFTER";
  }
  // Default to a signature failure: any other rejection from the library is a
  // failed assertion we must not trust.
  return "FAILED_SIG";
}

type SamlAttributes = Record<string, unknown>;

/** Extract the group list from the assertion attributes. */
export function extractGroups(
  attributes: SamlAttributes,
  config: Pick<SsoConfig, "groupAttributeName">
): string[] {
  const names = config.groupAttributeName
    ? [config.groupAttributeName]
    : DEFAULT_GROUP_ATTRS;
  const out: string[] = [];
  for (const name of names) {
    const raw = attributes[name];
    if (raw == null) continue;
    if (Array.isArray(raw)) out.push(...raw.map((v) => String(v)));
    else out.push(String(raw));
  }
  return out.map((g) => g.trim()).filter(Boolean);
}

/**
 * Highest-privilege mapped role wins. Unmapped groups are ignored. No mapped
 * group falls back to defaultRole.
 */
export function pickRole(
  groups: string[],
  config: Pick<SsoConfig, "groupRoleMap" | "defaultRole">
): BuyerOrgRole {
  const map = (config.groupRoleMap as Record<string, string> | null) ?? {};
  let best: BuyerOrgRole | null = null;
  for (const g of groups) {
    const mapped = map[g];
    if (!mapped) continue;
    const role = mapped as BuyerOrgRole;
    if (ROLE_PRIORITY[role] == null) continue;
    if (best === null || ROLE_PRIORITY[role] > ROLE_PRIORITY[best]) best = role;
  }
  return best ?? config.defaultRole;
}

function nameFromAttributes(attributes: SamlAttributes, email: string): string {
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = attributes[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  const display = pick(
    "displayName",
    "http://schemas.microsoft.com/identity/claims/displayname",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"
  );
  if (display) return display;
  const first = pick(
    "firstName",
    "givenName",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"
  );
  const last = pick(
    "lastName",
    "surname",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"
  );
  const joined = [first, last].filter(Boolean).join(" ").trim();
  if (joined) return joined;
  return email.split("@")[0];
}

export type ProvisionResult = {
  userId: string;
  role: BuyerOrgRole;
  provisioned: boolean;
};

/**
 * JIT-provision (or update) a user from a verified SAML assertion. The email
 * is attested by the IdP, so a new user is created emailVerified with an empty
 * passwordHash (which blocks password login: verifyPassword returns false on
 * an empty hash). On a returning user we refresh the org membership role from
 * the group map so IdP group changes propagate on next login.
 */
export async function provisionSsoUser(args: {
  config: SsoConfig;
  email: string;
  attributes: SamlAttributes;
}): Promise<ProvisionResult> {
  const email = args.email.toLowerCase().trim();
  const groups = extractGroups(args.attributes, args.config);
  const role = pickRole(groups, args.config);
  const orgId = args.config.buyerOrgId;

  let user = await prisma.user.findUnique({ where: { email } });
  let provisioned = false;
  if (!user) {
    const name = nameFromAttributes(args.attributes, email);
    user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: "",
        role: "BUYER",
        emailVerified: new Date(),
        activeBuyerOrgId: orgId,
      },
    });
    provisioned = true;
    await writeAuditLog({
      actor: { id: user.id, email: user.email },
      action: "SSO_PROVISIONED",
      targetType: "User",
      targetId: user.id,
      summary: `JIT-provisioned ${email} via SSO into org ${orgId} as ${role}.`,
      metadata: { orgId, role, groups },
    });
  }

  const existing = await prisma.buyerOrgMember.findUnique({
    where: { buyerOrgId_userId: { buyerOrgId: orgId, userId: user.id } },
  });
  if (!existing) {
    await prisma.buyerOrgMember.create({
      data: { buyerOrgId: orgId, userId: user.id, role },
    });
  } else if (existing.role !== role) {
    await prisma.buyerOrgMember.update({
      where: { id: existing.id },
      data: { role },
    });
  }

  // Keep the SSO org active. Also run the shared domain auto-join helper so any
  // other org that claimed this verified domain picks the user up too.
  if (user.activeBuyerOrgId !== orgId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { activeBuyerOrgId: orgId },
    });
  }
  await autoJoinByEmailDomain({
    id: user.id,
    email: user.email,
    activeBuyerOrgId: orgId,
  });

  return { userId: user.id, role, provisioned };
}

export function ipHash(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = xff || req.headers.get("x-real-ip") || "unknown";
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

/** Write a row to the high-volume SsoLoginEvent table. Best-effort. */
export async function recordSsoEvent(args: {
  buyerOrgId: string;
  userId?: string | null;
  email: string;
  outcome: SsoOutcome;
  req: Request;
}): Promise<void> {
  try {
    await prisma.ssoLoginEvent.create({
      data: {
        buyerOrgId: args.buyerOrgId,
        userId: args.userId ?? null,
        email: args.email.toLowerCase().slice(0, 320),
        outcome: args.outcome,
        ipHash: ipHash(args.req),
        userAgent: (args.req.headers.get("user-agent") || "").slice(0, 400),
      },
    });
  } catch {
    // Never let the audit write fail the login flow.
  }
}

/** Effective session lifetime in seconds from an org's SSO policy. */
export function ssoSessionMaxAgeSec(config: Pick<SsoConfig, "sessionMaxAgeMin">): number {
  return Math.max(60, config.sessionMaxAgeMin * 60);
}

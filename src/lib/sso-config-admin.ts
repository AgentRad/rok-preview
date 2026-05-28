import "server-only";
import type { BuyerOrgRole, Prisma, SsoConfig, User } from "@prisma/client";
import { prisma } from "./db";
import { writeAuditLog } from "./audit";
import { normalizeDomainClaim } from "./free-email-domains";
import { acsUrl, spEntityId } from "./sso";
import { siteUrl } from "./site-url";

const ROLES: BuyerOrgRole[] = ["ADMIN", "APPROVER", "BUYER", "VIEWER"];

export type SsoConfigView = {
  exists: boolean;
  spEntityId: string;
  acsUrl: string;
  metadataUrl: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpSloUrl: string;
  idpX509Cert: string;
  idpX509CertNext: string;
  domainAllowlist: string[];
  groupAttributeName: string;
  groupRoleMap: Record<string, string>;
  defaultRole: BuyerOrgRole;
  enforced: boolean;
  sessionMaxAgeMin: number;
  honorIdpSessionExpiry: boolean;
  rotatedCertAt: string | null;
};

export async function readSsoConfigView(orgId: string): Promise<SsoConfigView> {
  const c = await prisma.ssoConfig.findUnique({ where: { buyerOrgId: orgId } });
  return {
    exists: !!c,
    spEntityId: spEntityId(orgId),
    acsUrl: acsUrl(orgId),
    metadataUrl: siteUrl(`/api/auth/sso/saml/${orgId}/metadata`),
    idpEntityId: c?.idpEntityId ?? "",
    idpSsoUrl: c?.idpSsoUrl ?? "",
    idpSloUrl: c?.idpSloUrl ?? "",
    idpX509Cert: c?.idpX509Cert ?? "",
    idpX509CertNext: c?.idpX509CertNext ?? "",
    domainAllowlist: c?.domainAllowlist ?? [],
    groupAttributeName: c?.groupAttributeName ?? "",
    groupRoleMap: (c?.groupRoleMap as Record<string, string> | null) ?? {},
    defaultRole: c?.defaultRole ?? "BUYER",
    enforced: c?.enforced ?? false,
    sessionMaxAgeMin: c?.sessionMaxAgeMin ?? 480,
    honorIdpSessionExpiry: c?.honorIdpSessionExpiry ?? true,
    rotatedCertAt: c?.rotatedCertAt ? c.rotatedCertAt.toISOString() : null,
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseGroupRoleMap(raw: unknown): Record<string, string> {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return {};
    try {
      obj = JSON.parse(t);
    } catch {
      throw new Error("Group-to-role map must be valid JSON.");
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const role = String(v).toUpperCase();
    if (!ROLES.includes(role as BuyerOrgRole)) {
      throw new Error(`Invalid role "${v}" in group map.`);
    }
    const key = k.trim();
    if (key) out[key] = role;
  }
  return out;
}

function parseAllowlist(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw.map(String)
    : String(raw ?? "").split(/[\s,]+/);
  const out = new Set<string>();
  for (const p of parts) {
    const d = normalizeDomainClaim(p);
    if (d) out.add(d);
  }
  return [...out];
}

/**
 * Upsert an org's SSO config. SAML-only this round. Detects a signing-cert
 * change and stamps rotatedCertAt + a dedicated SSO_CERT_ROTATED audit row.
 */
export async function upsertSsoConfig(
  orgId: string,
  actor: Pick<User, "id" | "email">,
  body: Record<string, unknown>
): Promise<SsoConfig> {
  const existing = await prisma.ssoConfig.findUnique({
    where: { buyerOrgId: orgId },
  });

  const groupRoleMap = parseGroupRoleMap(body.groupRoleMap);
  const domainAllowlist = parseAllowlist(body.domainAllowlist);
  const defaultRoleRaw = String(body.defaultRole ?? "BUYER").toUpperCase();
  const defaultRole = (ROLES.includes(defaultRoleRaw as BuyerOrgRole)
    ? defaultRoleRaw
    : "BUYER") as BuyerOrgRole;
  const sessionMaxAgeMin = Math.min(
    43200,
    Math.max(5, Math.round(Number(body.sessionMaxAgeMin) || 480))
  );
  const newCert = str(body.idpX509Cert);
  const newCertNext = str(body.idpX509CertNext);
  const certRotated = !!existing && !!newCert && existing.idpX509Cert !== newCert;

  const data = {
    idpType: "SAML" as const,
    idpEntityId: str(body.idpEntityId) || null,
    idpSsoUrl: str(body.idpSsoUrl) || null,
    idpSloUrl: str(body.idpSloUrl) || null,
    idpX509Cert: newCert || null,
    idpX509CertNext: newCertNext || null,
    domainAllowlist,
    groupAttributeName: str(body.groupAttributeName) || null,
    groupRoleMap: groupRoleMap as Prisma.InputJsonValue,
    defaultRole,
    enforced: body.enforced === true || body.enforced === "true",
    sessionMaxAgeMin,
    honorIdpSessionExpiry:
      body.honorIdpSessionExpiry === undefined
        ? true
        : body.honorIdpSessionExpiry === true ||
          body.honorIdpSessionExpiry === "true",
    configuredById: actor.id,
    ...(certRotated ? { rotatedCertAt: new Date() } : {}),
  };

  const saved = await prisma.ssoConfig.upsert({
    where: { buyerOrgId: orgId },
    create: { buyerOrgId: orgId, ...data },
    update: data,
  });

  await writeAuditLog({
    actor,
    action: "SSO_CONFIG_UPDATED",
    targetType: "SsoConfig",
    targetId: saved.id,
    summary: `SSO config ${existing ? "updated" : "created"} for org ${orgId}.`,
    metadata: {
      orgId,
      enforced: saved.enforced,
      domainCount: domainAllowlist.length,
    },
  });
  if (certRotated) {
    await writeAuditLog({
      actor,
      action: "SSO_CERT_ROTATED",
      targetType: "SsoConfig",
      targetId: saved.id,
      summary: `SSO signing certificate rotated for org ${orgId}.`,
      metadata: { orgId },
    });
  }
  return saved;
}

export async function removeSsoConfig(
  orgId: string,
  actor: Pick<User, "id" | "email">
): Promise<void> {
  const existing = await prisma.ssoConfig.findUnique({
    where: { buyerOrgId: orgId },
  });
  if (!existing) return;
  await prisma.ssoConfig.delete({ where: { buyerOrgId: orgId } });
  await writeAuditLog({
    actor,
    action: "SSO_CONFIG_REMOVED",
    targetType: "SsoConfig",
    targetId: existing.id,
    summary: `SSO config removed for org ${orgId}.`,
    metadata: { orgId },
  });
}

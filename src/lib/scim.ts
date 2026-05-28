import "server-only";
import crypto from "node:crypto";
import type { BuyerOrgMember, SsoConfig, User } from "@prisma/client";
import { prisma } from "./db";
import { writeAuditLog } from "./audit";
import { siteUrl } from "./site-url";

// PLH-3y-5: SCIM 2.0 provisioning. Scope for v1 is users (read / create /
// update / deactivate). Groups are read-only (they exist for role mapping;
// PartsPort does not let an IdP edit which roles exist). The bearer token is
// never stored raw: we keep sha256(token) and the last 4 chars for the UI.

const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

export function hashScimToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a fresh SCIM bearer token. Returns the raw token (shown once) plus
 * the hash + last4 to persist. The caller writes these to SsoConfig and never
 * stores the raw value.
 */
export function generateScimToken(): {
  raw: string;
  hash: string;
  last4: string;
} {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashScimToken(raw), last4: raw.slice(-4) };
}

/** Constant-time compare of a presented bearer token against the stored hash. */
export function scimTokenMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashScimToken(presented), "utf8");
  const b = Buffer.from(storedHash, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Authenticate a SCIM request against an org's config. Reads the Bearer token,
 * constant-time compares it to SsoConfig.scimTokenHash, and requires
 * scimEnabled. Returns the config on success or null on any failure (the
 * caller returns 401 without distinguishing the reason).
 */
export async function authenticateScim(
  orgId: string,
  req: Request
): Promise<SsoConfig | null> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  const config = await prisma.ssoConfig.findUnique({
    where: { buyerOrgId: orgId },
  });
  if (!config || !config.scimEnabled || !config.scimTokenHash) return null;
  if (!scimTokenMatches(token, config.scimTokenHash)) return null;
  return config;
}

export function scimError(status: number, detail: string): Response {
  return new Response(
    JSON.stringify({
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(status),
      detail,
    }),
    { status, headers: { "content-type": "application/scim+json" } }
  );
}

export function scimJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/scim+json" },
  });
}

type MemberWithUser = BuyerOrgMember & { user: User };

/** Map a User + BuyerOrgMember to a SCIM User resource. */
export function toScimUser(orgId: string, m: MemberWithUser): Record<string, unknown> {
  const u = m.user;
  const [givenName, ...rest] = (u.name || "").trim().split(/\s+/);
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: u.id,
    userName: u.email,
    name: {
      formatted: u.name || u.email,
      givenName: givenName || "",
      familyName: rest.join(" "),
    },
    displayName: u.name || u.email,
    emails: [{ value: u.email, primary: true, type: "work" }],
    active: m.deactivatedAt == null,
    meta: {
      resourceType: "User",
      location: siteUrl(`/api/scim/v2/${orgId}/Users/${u.id}`),
    },
  };
}

/**
 * Parse the subset of SCIM filter syntax Okta/Azure send on every login:
 *   userName eq "x@y.com"  (also emails / externalId)
 * Returns the lowercased email when matched, else null (= list all).
 */
export function parseScimUserFilter(filter: string | null): string | null {
  if (!filter) return null;
  const m = filter.match(
    /\b(?:userName|emails(?:\.value)?|externalId)\s+eq\s+"([^"]+)"/i
  );
  return m ? m[1].toLowerCase().trim() : null;
}

/** Read a value out of a SCIM PATCH Operations array for the `active` flag. */
export function patchActiveValue(body: unknown): boolean | null {
  if (!body || typeof body !== "object") return null;
  const ops = (body as { Operations?: unknown }).Operations;
  if (!Array.isArray(ops)) return null;
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    const path = String((op as { path?: unknown }).path ?? "").toLowerCase();
    const value = (op as { value?: unknown }).value;
    // Form 1: { op: "replace", path: "active", value: false }
    if (path === "active") {
      return coerceBool(value);
    }
    // Form 2: { op: "replace", value: { active: false } } (no path)
    if (!path && value && typeof value === "object" && "active" in value) {
      return coerceBool((value as { active: unknown }).active);
    }
  }
  return null;
}

function coerceBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "True") return true;
  if (v === "false" || v === "False") return false;
  return null;
}

/**
 * Soft-deactivate a membership (SCIM PATCH active=false or DELETE). Sets
 * deactivatedAt and bumps the user's sessionsValidFrom so outstanding cookies
 * die immediately. Order history is preserved (no hard delete). Idempotent.
 */
export async function deactivateScimMember(args: {
  orgId: string;
  member: MemberWithUser;
}): Promise<void> {
  const { orgId, member } = args;
  if (member.deactivatedAt) return;
  await prisma.$transaction([
    prisma.buyerOrgMember.update({
      where: { id: member.id },
      data: { deactivatedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: member.userId },
      data: { sessionsValidFrom: new Date() },
    }),
  ]);
  await writeAuditLog({
    actor: { id: member.userId, email: member.user.email },
    action: "SSO_DEPROVISIONED",
    targetType: "BuyerOrg",
    targetId: orgId,
    summary: `SCIM deprovisioned ${member.user.email} from org ${orgId}.`,
    metadata: { orgId, userId: member.userId },
  });
}

/** Re-activate a soft-deactivated membership (SCIM PATCH active=true). */
export async function reactivateScimMember(args: {
  orgId: string;
  member: MemberWithUser;
}): Promise<void> {
  const { orgId, member } = args;
  if (!member.deactivatedAt) return;
  await prisma.buyerOrgMember.update({
    where: { id: member.id },
    data: { deactivatedAt: null },
  });
  await writeAuditLog({
    actor: { id: member.userId, email: member.user.email },
    action: "SCIM_USER_UPDATED",
    targetType: "BuyerOrg",
    targetId: orgId,
    summary: `SCIM reactivated ${member.user.email} in org ${orgId}.`,
    metadata: { orgId, userId: member.userId, active: true },
  });
}

export {
  SCIM_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
  SCIM_LIST_SCHEMA,
  SCIM_ERROR_SCHEMA,
};

import {
  authenticateScim,
  parseScimUserFilter,
  scimError,
  scimJson,
  toScimUser,
  SCIM_LIST_SCHEMA,
} from "@/lib/scim";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

async function gate(orgId: string, req: Request) {
  const rl = await rateLimit("scim", `org:${orgId}`);
  if (!rl.allowed) return { resp: scimError(429, "Too many requests.") };
  const config = await authenticateScim(orgId, req);
  if (!config) return { resp: scimError(401, "Unauthorized.") };
  return { config };
}

/**
 * PLH-3y-5: SCIM 2.0 Users collection. GET lists (or filters by userName,
 * which Okta calls on every login). POST creates a user + org membership
 * (JIT-equivalent). Bearer token = SsoConfig.scimTokenHash, constant-time.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const g = await gate(orgId, req);
  if (g.resp) return g.resp;

  const url = new URL(req.url);
  const email = parseScimUserFilter(url.searchParams.get("filter"));
  const startIndex = Math.max(1, Number(url.searchParams.get("startIndex")) || 1);
  const count = Math.min(200, Math.max(0, Number(url.searchParams.get("count")) || 100));

  const where = {
    buyerOrgId: orgId,
    ...(email ? { user: { email } } : {}),
  };
  const total = await prisma.buyerOrgMember.count({ where });
  const members = await prisma.buyerOrgMember.findMany({
    where,
    include: { user: true },
    orderBy: { joinedAt: "asc" },
    skip: startIndex - 1,
    take: count,
  });

  return scimJson({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: total,
    startIndex,
    itemsPerPage: members.length,
    Resources: members.map((m) => toScimUser(orgId, m)),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const g = await gate(orgId, req);
  if (g.resp) return g.resp;
  const config = g.config!;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return scimError(400, "Invalid SCIM payload.");
  }
  const userName = String(
    (body as { userName?: unknown }).userName ?? ""
  ).toLowerCase().trim();
  const emailFromEmails = Array.isArray((body as { emails?: unknown }).emails)
    ? String(
        ((body as { emails: Array<{ value?: unknown }> }).emails[0]?.value) ?? ""
      ).toLowerCase().trim()
    : "";
  const email = userName.includes("@") ? userName : emailFromEmails;
  if (!email || !email.includes("@")) {
    return scimError(400, "userName must be an email address.");
  }
  const nameObj = (body as { name?: { givenName?: unknown; familyName?: unknown; formatted?: unknown } }).name;
  const displayName = String((body as { displayName?: unknown }).displayName ?? "");
  const name =
    displayName.trim() ||
    [nameObj?.givenName, nameObj?.familyName]
      .filter((v) => typeof v === "string" && v)
      .join(" ")
      .trim() ||
    String(nameObj?.formatted ?? "").trim() ||
    email.split("@")[0];
  const activeRaw = (body as { active?: unknown }).active;
  const active = activeRaw === undefined ? true : activeRaw !== false;

  // Find or create the underlying User. IdP attests the email, so a new user
  // is emailVerified with an empty passwordHash (blocks password login).
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
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
  }

  const existing = await prisma.buyerOrgMember.findUnique({
    where: { buyerOrgId_userId: { buyerOrgId: orgId, userId: user.id } },
    include: { user: true },
  });
  if (existing) {
    // SCIM POST on an existing member is a conflict per RFC 7644.
    return scimError(409, "User already provisioned for this organization.");
  }

  const member = await prisma.buyerOrgMember.create({
    data: {
      buyerOrgId: orgId,
      userId: user.id,
      role: config.defaultRole,
      deactivatedAt: active ? null : new Date(),
    },
    include: { user: true },
  });

  await writeAuditLog({
    actor: { id: user.id, email },
    action: "SCIM_USER_PROVISIONED",
    targetType: "BuyerOrg",
    targetId: orgId,
    summary: `SCIM provisioned ${email} into org ${orgId} as ${config.defaultRole}.`,
    metadata: { orgId, userId: user.id, role: config.defaultRole, active },
  });

  return scimJson(toScimUser(orgId, member), 201);
}

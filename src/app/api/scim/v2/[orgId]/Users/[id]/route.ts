import {
  authenticateScim,
  deactivateScimMember,
  patchActiveValue,
  reactivateScimMember,
  scimError,
  scimJson,
  toScimUser,
} from "@/lib/scim";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

async function load(orgId: string, req: Request, userId: string) {
  const rl = await rateLimit("scim", `org:${orgId}`);
  if (!rl.allowed) return { resp: scimError(429, "Too many requests.") };
  const config = await authenticateScim(orgId, req);
  if (!config) return { resp: scimError(401, "Unauthorized.") };
  const member = await prisma.buyerOrgMember.findUnique({
    where: { buyerOrgId_userId: { buyerOrgId: orgId, userId } },
    include: { user: true },
  });
  if (!member) return { resp: scimError(404, "User not found.") };
  return { member };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ orgId: string; id: string }> }
) {
  const { orgId, id } = await params;
  const r = await load(orgId, req, id);
  if (r.resp) return r.resp;
  return scimJson(toScimUser(orgId, r.member!));
}

/**
 * PATCH: the IdP toggles `active`. active=false soft-deactivates (preserves
 * order history) and kills outstanding sessions; active=true reactivates.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ orgId: string; id: string }> }
) {
  const { orgId, id } = await params;
  const r = await load(orgId, req, id);
  if (r.resp) return r.resp;
  const member = r.member!;

  const body = await req.json().catch(() => null);
  const active = patchActiveValue(body);
  if (active === null) {
    // No supported op present. Return the current resource unchanged.
    return scimJson(toScimUser(orgId, member));
  }
  if (active === false) {
    await deactivateScimMember({ orgId, member });
  } else {
    await reactivateScimMember({ orgId, member });
  }
  const fresh = await prisma.buyerOrgMember.findUnique({
    where: { id: member.id },
    include: { user: true },
  });
  return scimJson(toScimUser(orgId, fresh!));
}

/** PUT full replace: update name (and active). Email change is audited. */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ orgId: string; id: string }> }
) {
  const { orgId, id } = await params;
  const r = await load(orgId, req, id);
  if (r.resp) return r.resp;
  const member = r.member!;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return scimError(400, "Invalid SCIM payload.");
  }
  const nameObj = (body as { name?: { givenName?: unknown; familyName?: unknown; formatted?: unknown } }).name;
  const displayName = String((body as { displayName?: unknown }).displayName ?? "");
  const newName =
    displayName.trim() ||
    [nameObj?.givenName, nameObj?.familyName]
      .filter((v) => typeof v === "string" && v)
      .join(" ")
      .trim() ||
    String(nameObj?.formatted ?? "").trim();
  if (newName && newName !== member.user.name) {
    await prisma.user.update({
      where: { id: member.userId },
      data: { name: newName },
    });
  }

  const activeRaw = (body as { active?: unknown }).active;
  if (activeRaw === false && !member.deactivatedAt) {
    await deactivateScimMember({ orgId, member });
  } else if (activeRaw === true && member.deactivatedAt) {
    await reactivateScimMember({ orgId, member });
  }

  await writeAuditLog({
    actor: { id: member.userId, email: member.user.email },
    action: "SCIM_USER_UPDATED",
    targetType: "BuyerOrg",
    targetId: orgId,
    summary: `SCIM updated ${member.user.email} in org ${orgId}.`,
    metadata: { orgId, userId: member.userId },
  });

  const fresh = await prisma.buyerOrgMember.findUnique({
    where: { id: member.id },
    include: { user: true },
  });
  return scimJson(toScimUser(orgId, fresh!));
}

/** DELETE: deprovision = soft-deactivate. Never hard-delete (order history). */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ orgId: string; id: string }> }
) {
  const { orgId, id } = await params;
  const r = await load(orgId, req, id);
  if (r.resp) return r.resp;
  await deactivateScimMember({ orgId, member: r.member! });
  return new Response(null, { status: 204 });
}

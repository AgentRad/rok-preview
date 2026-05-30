import {
  authenticateScim,
  scimError,
  scimJson,
  SCIM_GROUP_SCHEMA,
  SCIM_LIST_SCHEMA,
} from "@/lib/scim";
import type { BuyerOrgRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { siteUrl } from "@/lib/site-url";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const ROLES: BuyerOrgRole[] = ["ADMIN", "APPROVER", "BUYER", "VIEWER"];

/**
 * PLH-3y-5: read-only SCIM Groups. PartsPort's groups are its four org roles.
 * The IdP cannot edit them (role definitions are owned by PartsPort); this
 * endpoint exists so an IdP admin can inspect the role-to-member mapping while
 * debugging group-to-role assignment.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const rl = await rateLimit("scim", `org:${orgId}`);
  if (!rl.allowed) return scimError(429, "Too many requests.");
  const config = await authenticateScim(orgId, req);
  if (!config) return scimError(401, "Unauthorized.");

  const members = await prisma.buyerOrgMember.findMany({
    where: { buyerOrgId: orgId },
    include: { user: true },
    orderBy: { joinedAt: "asc" },
  });

  const groups = ROLES.map((role) => {
    const inRole = members.filter((m) => m.role === role);
    return {
      schemas: [SCIM_GROUP_SCHEMA],
      id: `${orgId}:${role}`,
      displayName: role,
      members: inRole.map((m) => ({
        value: m.userId,
        display: m.user.email,
        $ref: siteUrl(`/api/scim/v2/${orgId}/Users/${m.userId}`),
      })),
      meta: {
        resourceType: "Group",
        location: siteUrl(`/api/scim/v2/${orgId}/Groups`),
      },
    };
  });

  return scimJson({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: groups.length,
    startIndex: 1,
    itemsPerPage: groups.length,
    Resources: groups,
  });
}

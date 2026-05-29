import "server-only";
import type { BuyerOrg, BuyerOrgRole, User } from "@prisma/client";
import { prisma } from "./db";
import { writeAuditLog } from "./audit";
import { emailDomain, isFreeEmailDomain } from "./free-email-domains";

export type BuyerOrgContext = {
  org: BuyerOrg;
  role: BuyerOrgRole;
};

// PLH-3y-1 permission model. APPROVER is a stub this round and is treated
// exactly like BUYER; the real approval behavior lands in PLH-3y-6.
//
// ADMIN:    manage members, see all org orders, manage org settings
// APPROVER: stub, treated like BUYER
// BUYER:    place orders, see own
// VIEWER:   read-only, cannot place orders

export function canManageBuyerOrg(role: BuyerOrgRole): boolean {
  return role === "ADMIN";
}

export function canSeeAllOrgOrders(role: BuyerOrgRole): boolean {
  return role === "ADMIN";
}

export function canPlaceOrgOrders(role: BuyerOrgRole): boolean {
  // VIEWER is read-only. APPROVER is treated like BUYER this round.
  return role === "ADMIN" || role === "APPROVER" || role === "BUYER";
}

// PLH-3y-2: who may charge the org's centralized card under HYBRID billing.
// Same set that may place orders: a VIEWER cannot pay at all, and everyone
// else who can place an order may opt to bill the org card. (A finer-grained
// per-member spend permission can layer on in a later round.)
export function canChargeOrgCard(role: BuyerOrgRole): boolean {
  return canPlaceOrgOrders(role);
}

// PLH-3y-6: who may act on the approval queue (view pending, approve/reject,
// bulk approve, manage rules). ADMIN and APPROVER. (ADMIN also gets emergency
// bypass; rule management is ADMIN-only, gated separately.)
export function canApproveOrders(role: BuyerOrgRole): boolean {
  return role === "ADMIN" || role === "APPROVER";
}

// PLH-3y-6: who may manage approval rules + emergency-bypass an order.
export function canManageApprovalRules(role: BuyerOrgRole): boolean {
  return role === "ADMIN";
}

// QA-re-audit FIX 2: validate a member referenced by an approval rule (the
// direct approverMemberId or the escalateToMemberId) exists in the org AND
// holds an approver-capable role. Stops a rule from assigning or escalating to a
// VIEWER/BUYER (which advanceApproval's single-source gate would then reject at
// decision time, leaving the order stuck PENDING). Returns false for a missing
// or cross-org member id.
export async function memberCanApproveInOrg(
  memberId: string,
  orgId: string
): Promise<boolean> {
  const m = await prisma.buyerOrgMember.findFirst({
    where: { id: memberId, buyerOrgId: orgId },
    select: { role: true },
  });
  return !!m && canApproveOrders(m.role);
}

const VALID_BUYER_ORG_ROLES: BuyerOrgRole[] = ["ADMIN", "APPROVER", "BUYER", "VIEWER"];

// QA-re-audit FIX 2: an approval rule must not assign or escalate to a member or
// role that cannot approve orders, otherwise the rule routes an order to an
// approver the single-source advanceApproval gate then rejects (order stuck
// PENDING). Validates the approver-by-member fields (approverMemberId,
// escalateToMemberId) and the approver-by-role field (approverRole) against the
// rule's create/update body. Returns an error string on the first violation, or
// null when clean. Only validates fields that are present + non-empty, so a
// PATCH that does not touch these fields passes.
export async function validateApprovalRuleApprovers(
  body: Record<string, unknown>,
  orgId: string
): Promise<string | null> {
  const approverMemberId = typeof body.approverMemberId === "string" ? body.approverMemberId.trim() : "";
  if (approverMemberId && !(await memberCanApproveInOrg(approverMemberId, orgId))) {
    return "The approver must be a member of this organization with an approver-capable role (APPROVER or ADMIN).";
  }
  const escalateToMemberId = typeof body.escalateToMemberId === "string" ? body.escalateToMemberId.trim() : "";
  if (escalateToMemberId && !(await memberCanApproveInOrg(escalateToMemberId, orgId))) {
    return "The escalation target must be a member of this organization with an approver-capable role (APPROVER or ADMIN).";
  }
  const approverRole = typeof body.approverRole === "string" ? body.approverRole.trim() : "";
  if (approverRole) {
    if (!VALID_BUYER_ORG_ROLES.includes(approverRole as BuyerOrgRole) || !canApproveOrders(approverRole as BuyerOrgRole)) {
      return "approverRole must be an approver-capable role (APPROVER or ADMIN).";
    }
  }
  return null;
}

/** Every buyer org the user belongs to, OWNER-style ordering (ADMIN first). */
export async function listBuyerOrgsForUser(
  userId: string
): Promise<BuyerOrgContext[]> {
  const memberships = await prisma.buyerOrgMember.findMany({
    where: { userId },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    include: { buyerOrg: true },
  });
  return memberships.map((m) => ({ org: m.buyerOrg, role: m.role }));
}

/**
 * The user's active buyer org context. Resolves User.activeBuyerOrgId when
 * set and still a valid membership; otherwise falls back to the first org the
 * user belongs to (and self-heals the stale activeBuyerOrgId). Returns null
 * when the user belongs to no orgs.
 */
export async function getActiveBuyerOrgContext(
  user: Pick<User, "id" | "activeBuyerOrgId">
): Promise<BuyerOrgContext | null> {
  const orgs = await listBuyerOrgsForUser(user.id);
  if (orgs.length === 0) return null;
  if (user.activeBuyerOrgId) {
    const match = orgs.find((o) => o.org.id === user.activeBuyerOrgId);
    if (match) return match;
    // Stale pointer (membership removed): self-heal to the first org.
    await prisma.user.update({
      where: { id: user.id },
      data: { activeBuyerOrgId: orgs[0].org.id },
    });
  }
  return orgs[0];
}

/**
 * PLH-3y-3: domain auto-join. Given a freshly-verified (or freshly-SSO'd) user,
 * checks whether their email domain matches a VERIFIED + autoJoinEnabled org
 * domain and, if so, adds them as a member with the domain's autoJoinRole and
 * sets activeBuyerOrgId when they have none.
 *
 * Forward-compatible with the SSO JIT path in PLH-3y-4: that flow will call
 * this same helper after provisioning a user from an IdP assertion, so the
 * domain-to-org mapping lives in one place.
 *
 * Idempotent: returns null when the user already belongs to the matched org,
 * when no domain matches, or when the domain is a public provider (belt: a
 * public domain can never have a VERIFIED row, but the check is cheap).
 * Best-effort and never throws back to the caller; auth must not fail because
 * an auto-join did.
 */
export async function autoJoinByEmailDomain(
  user: Pick<User, "id" | "email" | "activeBuyerOrgId">
): Promise<BuyerOrgContext | null> {
  try {
    const domain = emailDomain(user.email);
    if (!domain || isFreeEmailDomain(domain)) return null;

    const match = await prisma.buyerOrgDomain.findFirst({
      where: { domain, status: "VERIFIED", autoJoinEnabled: true },
      include: { buyerOrg: true },
    });
    if (!match) return null;

    const already = await prisma.buyerOrgMember.findUnique({
      where: { buyerOrgId_userId: { buyerOrgId: match.buyerOrgId, userId: user.id } },
    });
    if (already) return null;

    await prisma.buyerOrgMember.create({
      data: {
        buyerOrgId: match.buyerOrgId,
        userId: user.id,
        role: match.autoJoinRole,
      },
    });
    if (!user.activeBuyerOrgId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { activeBuyerOrgId: match.buyerOrgId },
      });
    }

    await writeAuditLog({
      actor: { id: user.id, email: user.email },
      action: "BUYER_ORG_DOMAIN_AUTOJOINED",
      targetType: "BuyerOrg",
      targetId: match.buyerOrgId,
      summary: `${user.email} auto-joined ${match.buyerOrg.name} as ${match.autoJoinRole} via domain ${domain}.`,
      metadata: { domain, role: match.autoJoinRole, domainId: match.id },
    });

    return { org: match.buyerOrg, role: match.autoJoinRole };
  } catch {
    // Never let an auto-join failure break the auth flow.
    return null;
  }
}

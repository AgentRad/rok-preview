import "server-only";
import type { BuyerOrg, BuyerOrgRole, User } from "@prisma/client";
import { prisma } from "./db";

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

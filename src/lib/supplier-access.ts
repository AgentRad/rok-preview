import "server-only";
import type { Supplier, SupplierMemberRole } from "@prisma/client";
import { prisma } from "./db";

export type SupplierContext = {
  supplier: Supplier;
  role: SupplierMemberRole;
};

/**
 * Returns the supplier the given user is acting for, and their role on it.
 * Resolution order:
 *   1. Direct SupplierMember row (the new team-accounts source of truth).
 *   2. Legacy Supplier.userId pointer (for any data not yet backfilled).
 *
 * Returns null when the user has no supplier access.
 */
export async function getSupplierContextForUser(
  userId: string
): Promise<SupplierContext | null> {
  const membership = await prisma.supplierMember.findFirst({
    where: { userId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }], // OWNER sorts before MEMBER
    include: { supplier: true },
  });
  if (membership) {
    return { supplier: membership.supplier, role: membership.role };
  }

  const legacy = await prisma.supplier.findUnique({ where: { userId } });
  if (legacy) return { supplier: legacy, role: "OWNER" };

  return null;
}

/** Returns true when the user has any membership on the given supplier. */
export async function userHasAccessToSupplier(
  userId: string,
  supplierId: string
): Promise<{ ok: boolean; role: SupplierMemberRole | null }> {
  const membership = await prisma.supplierMember.findUnique({
    where: { supplierId_userId: { supplierId, userId } },
  });
  if (membership) return { ok: true, role: membership.role };

  const legacy = await prisma.supplier.findFirst({
    where: { id: supplierId, userId },
  });
  if (legacy) return { ok: true, role: "OWNER" };

  return { ok: false, role: null };
}

/** Roles allowed to edit the catalog, manage orders, respond to RFQs. */
export function canManageCatalog(role: SupplierMemberRole | null): boolean {
  return role === "OWNER" || role === "MEMBER";
}

/** Only the owner can manage the team itself. */
export function canManageTeam(role: SupplierMemberRole | null): boolean {
  return role === "OWNER";
}

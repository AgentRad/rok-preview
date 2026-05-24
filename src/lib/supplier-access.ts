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
 */
export async function getSupplierContextForUser(
  userId: string
): Promise<SupplierContext | null> {
  const membership = await prisma.supplierMember.findFirst({
    where: { userId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }], // OWNER first
    include: { supplier: true },
  });
  if (membership) {
    return { supplier: membership.supplier, role: membership.role };
  }

  const legacy = await prisma.supplier.findUnique({ where: { userId } });
  if (legacy) return { supplier: legacy, role: "OWNER" };

  return null;
}

/** Returns the user's role on a specific supplier, or null. */
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

// ---------------------------------------------------------------------------
// Permission matrix.
// ---------------------------------------------------------------------------
// OWNER       : full access + team management
// ADMIN       : full access except team management
// SALES       : RFQs + view orders + send messages + view invoices
// FULFILLMENT : view orders + fulfill stages + carrier/tracking + messages
// CATALOG     : products + images + bulk import
// FINANCE     : view payouts + view invoices + run CSV exports
// VIEWER      : read-only across catalog, orders, RFQs, payouts

type Role = SupplierMemberRole | null;
const anyOf = (role: Role, ...allowed: SupplierMemberRole[]) =>
  role !== null && allowed.includes(role);

export function canManageTeam(role: Role): boolean {
  return anyOf(role, "OWNER");
}

export function canEditCatalog(role: Role): boolean {
  return anyOf(role, "OWNER", "ADMIN", "CATALOG");
}

export function canViewCatalog(role: Role): boolean {
  return role !== null;
}

export function canRespondToQuotes(role: Role): boolean {
  return anyOf(role, "OWNER", "ADMIN", "SALES");
}

export function canViewQuotes(role: Role): boolean {
  return anyOf(role, "OWNER", "ADMIN", "SALES", "FULFILLMENT", "FINANCE", "VIEWER");
}

export function canViewOrders(role: Role): boolean {
  return anyOf(role, "OWNER", "ADMIN", "SALES", "FULFILLMENT", "FINANCE", "VIEWER");
}

export function canFulfillOrders(role: Role): boolean {
  return anyOf(role, "OWNER", "ADMIN", "FULFILLMENT");
}

export function canViewPayouts(role: Role): boolean {
  return anyOf(role, "OWNER", "ADMIN", "FINANCE", "VIEWER");
}

export function canViewInvoices(role: Role): boolean {
  return anyOf(role, "OWNER", "ADMIN", "SALES", "FINANCE", "VIEWER");
}

export function canRunExports(role: Role): boolean {
  return anyOf(role, "OWNER", "ADMIN", "FINANCE");
}

export function canSendMessages(role: Role): boolean {
  return anyOf(role, "OWNER", "ADMIN", "SALES", "FULFILLMENT");
}

/** Short human-facing label for a role. */
export const ROLE_LABEL: Record<SupplierMemberRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  SALES: "Sales",
  FULFILLMENT: "Fulfillment",
  CATALOG: "Catalog",
  FINANCE: "Finance",
  VIEWER: "Viewer",
};

/** What each role is for, one sentence. */
export const ROLE_DESCRIPTION: Record<SupplierMemberRole, string> = {
  OWNER:
    "Full access. Can invite and remove team members and change anyone's role.",
  ADMIN: "Full operational access. Cannot manage the team.",
  SALES:
    "Respond to RFQs, view orders and invoices, message buyers. Cannot edit the catalog.",
  FULFILLMENT:
    "View orders, mark stages, add carrier and tracking, message buyers. Cannot edit the catalog or see payouts.",
  CATALOG:
    "Manage products, prices, stock, images and bulk imports. Cannot see orders or payouts.",
  FINANCE:
    "View payouts and invoices, run CSV exports. Cannot edit the catalog or fulfill orders.",
  VIEWER:
    "Read-only access across the catalog, orders, RFQs, payouts. Cannot make changes.",
};

import "server-only";
import type { Prisma, Supplier, SupplierMemberRole, User } from "@prisma/client";
import { prisma } from "./db";
import { getActingAsSupplier } from "./acting-as";

// Document kinds the onboarding checklist gates on. SUPPLIER_AGREEMENT, W9,
// and INSURANCE_COI must all be APPROVED for the supplier to be ready to
// go live. OTHER is a free-form slot for ad-hoc paperwork (W8, banking
// confirmations, lien releases, etc.) and isn't gated.
export const SUPPLIER_DOC_KINDS = [
  "SUPPLIER_AGREEMENT",
  "W9",
  "INSURANCE_COI",
  "OTHER",
] as const;
export type SupplierDocKind = (typeof SUPPLIER_DOC_KINDS)[number];

export const REQUIRED_DOC_KINDS: SupplierDocKind[] = [
  "SUPPLIER_AGREEMENT",
  "W9",
  "INSURANCE_COI",
];

export type SupplierContext = {
  supplier: Supplier;
  role: SupplierMemberRole;
  /** True when an admin is impersonating this supplier via the act-as cookie. */
  actingAsAdmin?: boolean;
};

/**
 * Request-aware lookup. Honors the admin "acting-as" cookie when set, so the
 * caller doesn't need to know about that mechanism. Use this in pages and
 * endpoints; getSupplierContextForUser is the lower-level primitive.
 */
export async function getActiveSupplierContext(
  user: User
): Promise<SupplierContext | null> {
  if (user.role === "ADMIN") {
    const actingAs = await getActingAsSupplier();
    if (actingAs) {
      const supplier = await prisma.supplier.findUnique({
        where: { id: actingAs },
      });
      if (supplier) {
        return { supplier, role: "OWNER", actingAsAdmin: true };
      }
    }
  }
  return getSupplierContextForUser(user.id);
}

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

/**
 * Same as userHasAccessToSupplier, but admins with an active act-as cookie
 * for this supplier are treated as OWNER. Use this in API routes that
 * suppliers normally hit so admin overrides work end-to-end.
 */
export async function effectiveAccessToSupplier(
  user: User,
  supplierId: string
): Promise<{ ok: boolean; role: SupplierMemberRole | null }> {
  if (user.role === "ADMIN") {
    const actingAs = await getActingAsSupplier();
    if (actingAs === supplierId) return { ok: true, role: "OWNER" };
  }
  return userHasAccessToSupplier(user.id, supplierId);
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

// Legal documents and bank info are sensitive: restrict to OWNER/ADMIN so a
// SALES or FULFILLMENT teammate can't upload a fake W9 or change last4.
export function canManageDocuments(role: Role): boolean {
  return anyOf(role, "OWNER", "ADMIN");
}

export function canManageBankInfo(role: Role): boolean {
  return anyOf(role, "OWNER", "ADMIN");
}

// ---------------------------------------------------------------------------
// Public visibility gate (THRADD onboarding, Polish 6).
// ---------------------------------------------------------------------------
// A supplier is "ready to go live" when every onboarding checklist item is
// satisfied. The flag that actually controls visibility is Supplier.publicVisible:
// it stays false until an admin flips it (typically after readiness passes).
// Existing demo suppliers were grandfathered to publicVisible=true in the
// 20260528000000_supplier_documents migration, so the demo catalog doesn't
// disappear on deploy.

export type ReadinessSupplier = {
  status: string;
  logoUrl: string | null;
  description: string;
  certifications: string;
  website: string;
  bankInfoStatus: string;
};

export type ReadinessDoc = {
  kind: string;
  status: string;
};

export type Readiness = {
  items: { key: string; label: string; done: boolean }[];
  done: number;
  total: number;
  ready: boolean;
};

/**
 * Computes the 10-item go-live checklist used by both the supplier
 * dashboard (for the gauge + banner) and the catalog visibility check.
 * Pure function so it's safe to call from server components, APIs, and
 * tests without hitting the DB.
 */
export function computeReadiness(
  supplier: ReadinessSupplier,
  docs: ReadinessDoc[],
  productCount: number
): Readiness {
  const hasApprovedDoc = (kind: string) =>
    docs.some((d) => d.kind === kind && d.status === "APPROVED");

  const items: { key: string; label: string; done: boolean }[] = [
    {
      key: "approved",
      label: "Profile approved",
      done: supplier.status === "APPROVED",
    },
    {
      key: "logo",
      label: "Company logo uploaded",
      done: !!supplier.logoUrl,
    },
    {
      key: "description",
      label: "One-sentence description written",
      done: !!(supplier.description && supplier.description.trim()),
    },
    {
      key: "certifications",
      label: "Certifications listed",
      done: !!(supplier.certifications && supplier.certifications.trim()),
    },
    {
      key: "website",
      label: "Website added",
      done: !!(supplier.website && supplier.website.trim()),
    },
    {
      key: "supplier_agreement",
      label: "Supplier Agreement signed and approved",
      done: hasApprovedDoc("SUPPLIER_AGREEMENT"),
    },
    {
      key: "w9",
      label: "W9 on file and approved",
      done: hasApprovedDoc("W9"),
    },
    {
      key: "insurance",
      label: "Certificate of Insurance approved",
      done: hasApprovedDoc("INSURANCE_COI"),
    },
    {
      key: "bank",
      label: "Bank info on file",
      done: supplier.bankInfoStatus === "ON_FILE",
    },
    {
      key: "product",
      label: "At least one product published",
      done: productCount > 0,
    },
  ];
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  return { items, done, total, ready: done === total };
}

/**
 * Where-fragment to filter products to only those owned by suppliers that
 * are both APPROVED and publicVisible. Apply this to every public query:
 * catalog, home featured, brand storefront, product detail (combined with
 * notFound when missing), sitemap, search.
 *
 * Use as: `where: { active: true, ...publicProductFilter() }`.
 */
export function publicProductFilter(): Prisma.ProductWhereInput {
  return {
    supplier: { is: { publicVisible: true, status: "APPROVED" } },
  };
}

/**
 * Same-shape `where` for Supplier queries that should only return live
 * suppliers (e.g. the home page's supplier count).
 */
export function publicSupplierFilter(): Prisma.SupplierWhereInput {
  return { publicVisible: true, status: "APPROVED" };
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

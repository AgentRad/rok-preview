import "server-only";
import { prisma } from "./db";
import { writeAuditLog } from "./audit";
import { normalizeEmail } from "./user-input";

/**
 * PLH-3w P1: account suspend/ban with cascading effects.
 *
 * Suspension and ban are both hard account locks: login is refused (see
 * /api/auth/login) and every outstanding session is killed by bumping
 * sessionsValidFrom. Beyond that, suspending a supplier-owner or OEM has
 * marketplace-visible side effects, handled here so the admin route and
 * any future caller share one code path.
 *
 * Supplier cascade: the suspended user's owned suppliers flip to
 * status=SUSPENDED + publicVisible=false. publicProductFilter() keys off
 * supplier.publicVisible/status, so this unpublishes the supplier's whole
 * catalog and the existing SUSPENDED-supplier gates (PLH-1 commit 3)
 * block new order/RFQ acceptance. Existing in-flight orders are untouched
 * and complete normally.
 *
 * OEM cascade: the storefront queries (manufacturers list + [slug] page +
 * listClaimedManufacturers) filter on User.status = ACTIVE, so a suspended
 * MANUFACTURER's storefront 404s without any extra write here.
 */

/** Supplier ids the user owns, via SupplierMember(OWNER) or legacy userId. */
async function ownedSupplierIds(userId: string): Promise<string[]> {
  const memberships = await prisma.supplierMember.findMany({
    where: { userId, role: "OWNER" },
    select: { supplierId: true },
  });
  const legacy = await prisma.supplier.findMany({
    where: { userId },
    select: { id: true },
  });
  const ids = new Set<string>();
  for (const m of memberships) ids.add(m.supplierId);
  for (const s of legacy) ids.add(s.id);
  return Array.from(ids);
}

async function cascadeSupplierLock(userId: string): Promise<number> {
  const ids = await ownedSupplierIds(userId);
  if (ids.length === 0) return 0;
  await prisma.supplier.updateMany({
    where: { id: { in: ids } },
    data: { status: "SUSPENDED", publicVisible: false },
  });
  return ids.length;
}

export async function suspendUser(args: {
  targetUserId: string;
  reason: string;
  admin: { id: string; email: string };
}): Promise<void> {
  const reason = args.reason.trim().slice(0, 500);
  const now = new Date();
  await prisma.user.update({
    where: { id: args.targetUserId },
    data: {
      status: "SUSPENDED",
      suspendedAt: now,
      suspendedReason: reason,
      suspendedByUserId: args.admin.id,
      // Kill every outstanding session cookie.
      sessionsValidFrom: now,
    },
  });
  const supplierCount = await cascadeSupplierLock(args.targetUserId);
  await writeAuditLog({
    actor: args.admin,
    action: "USER_SUSPENDED",
    targetType: "User",
    targetId: args.targetUserId,
    summary: `Suspended user. ${supplierCount} supplier(s) hidden.`,
    metadata: { reason, suppliersHidden: supplierCount },
  });
}

export async function unsuspendUser(args: {
  targetUserId: string;
  admin: { id: string; email: string };
}): Promise<void> {
  await prisma.user.update({
    where: { id: args.targetUserId },
    data: {
      status: "ACTIVE",
      suspendedAt: null,
      suspendedReason: null,
      suspendedByUserId: null,
    },
  });
  // Supplier orgs are NOT auto-republished: re-approving a supplier and
  // flipping publicVisible is a deliberate admin step (the go-live gate),
  // so we leave them SUSPENDED for the admin to review and re-approve.
  await writeAuditLog({
    actor: args.admin,
    action: "USER_UNSUSPENDED",
    targetType: "User",
    targetId: args.targetUserId,
    summary: "Lifted user suspension.",
    metadata: null,
  });
}

export async function banUser(args: {
  targetUserId: string;
  reason: string;
  admin: { id: string; email: string };
}): Promise<void> {
  const reason = args.reason.trim().slice(0, 500);
  const now = new Date();
  const user = await prisma.user.update({
    where: { id: args.targetUserId },
    data: {
      status: "BANNED",
      suspendedAt: now,
      suspendedReason: reason,
      suspendedByUserId: args.admin.id,
      sessionsValidFrom: now,
    },
    select: { email: true },
  });
  const supplierCount = await cascadeSupplierLock(args.targetUserId);
  const email = normalizeEmail(user.email);
  if (email) {
    await prisma.bannedEmail.upsert({
      where: { email },
      create: { email, bannedByUserId: args.admin.id, reason },
      update: { bannedByUserId: args.admin.id, reason, bannedAt: now },
    });
  }
  await writeAuditLog({
    actor: args.admin,
    action: "USER_BANNED",
    targetType: "User",
    targetId: args.targetUserId,
    summary: `Banned user and blacklisted email. ${supplierCount} supplier(s) hidden.`,
    metadata: { reason, suppliersHidden: supplierCount },
  });
}

import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "./db";

/**
 * PLH-3w P2: per-role 2FA enforcement.
 *
 * REQUIRE_2FA_FOR_ROLES is a comma-separated list of role tokens that must
 * have 2FA enabled. Recognized tokens:
 *   ADMIN           - User.role === "ADMIN"
 *   SUPPLIER        - User.role === "SUPPLIER" (any supplier teammate)
 *   SUPPLIER_OWNER  - owns a Supplier (SupplierMember OWNER or legacy userId)
 *   MANUFACTURER    - User.role === "MANUFACTURER"
 *   BUYER           - User.role === "BUYER"
 *
 * Matching users with 2FA off see a banner during a 24h grace window
 * (measured from createdAt) and a blocking interstitial after it. An admin
 * can grant a 1-hour recovery override (twoFactorRecoveryUntil) that
 * suppresses the interstitial so the user can re-enroll.
 */

const GRACE_MS = 24 * 60 * 60 * 1000;

function parseRequiredRoles(): Set<string> {
  const raw = process.env.REQUIRE_2FA_FOR_ROLES || "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  );
}

async function ownsSupplier(userId: string): Promise<boolean> {
  const member = await prisma.supplierMember.findFirst({
    where: { userId, role: "OWNER" },
    select: { id: true },
  });
  if (member) return true;
  const legacy = await prisma.supplier.findFirst({
    where: { userId },
    select: { id: true },
  });
  return !!legacy;
}

export type TwoFactorState = {
  /** 2FA is required for this user's role(s) and is not yet enabled. */
  required: boolean;
  /** Within the 24h grace window: show a banner, do not block. */
  inGrace: boolean;
  /** Past grace with no active recovery override: show blocking interstitial. */
  mustEnrollNow: boolean;
  graceEndsAt: Date | null;
};

const INACTIVE: TwoFactorState = {
  required: false,
  inGrace: false,
  mustEnrollNow: false,
  graceEndsAt: null,
};

export async function getTwoFactorState(user: User): Promise<TwoFactorState> {
  // Already enrolled: nothing to enforce.
  if (user.totpEnabledAt) return INACTIVE;

  const roles = parseRequiredRoles();
  if (roles.size === 0) return INACTIVE;

  let matches = roles.has(user.role);
  if (!matches && roles.has("SUPPLIER_OWNER")) {
    matches = await ownsSupplier(user.id);
  }
  if (!matches) return INACTIVE;

  const graceEndsAt = new Date(user.createdAt.getTime() + GRACE_MS);
  const inGrace = Date.now() < graceEndsAt.getTime();

  // Admin recovery override suppresses the blocking interstitial.
  const recoveryActive =
    !!user.twoFactorRecoveryUntil &&
    user.twoFactorRecoveryUntil.getTime() > Date.now();

  return {
    required: true,
    inGrace,
    mustEnrollNow: !inGrace && !recoveryActive,
    graceEndsAt,
  };
}

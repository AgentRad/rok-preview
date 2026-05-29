import "server-only";
import { cookies } from "next/headers";
import { buildActingAsCookie, verifyActingAsCookie } from "./route-guards";

/**
 * Admin "act as supplier" cookie. When set, getActiveSupplierContext returns
 * that supplier (as OWNER) for admin users, so the existing supplier endpoints
 * and dashboard work end-to-end without duplicating routes.
 *
 * The cookie is httpOnly and short-lived. Clearing is just deleting the
 * cookie or calling clearActingAsSupplier().
 *
 * QA2 BUG 2: the value is signed (HMAC over `${supplierId}.${adminUserId}`)
 * and bound to the admin who set it, so a value set under one admin session
 * is not honored under any other admin session, and a non-admin cannot mint a
 * value that verifies. The admin-role gate in getActiveSupplierContext stays.
 */
const COOKIE = "pp_acting_as";

// Same secret-derivation pattern as order-link.ts / approval-token.ts:
// prefer a dedicated secret, fall back to SESSION_SECRET, then a dev-only
// constant. No new env var is required for this to work in production
// (SESSION_SECRET is always set there and is >= 32 chars).
function actingAsSecret(): string {
  return (
    process.env.ACTING_AS_SECRET ||
    process.env.SESSION_SECRET ||
    "partsport-acting-as-fallback"
  );
}

export async function setActingAsSupplier(
  supplierId: string,
  adminUserId: string
): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, buildActingAsCookie(supplierId, adminUserId, actingAsSecret()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8, // eight hours; long enough for a working session
  });
}

export async function clearActingAsSupplier(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/**
 * Returns the impersonated supplierId only when the cookie's signature is
 * valid AND its bound admin id matches `adminUserId` (the current session
 * user). Any mismatch (tampered value, wrong admin, unsigned legacy value)
 * returns null so the caller falls back to no impersonation.
 */
export async function getActingAsSupplier(
  adminUserId: string
): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value || null;
  return verifyActingAsCookie(raw, adminUserId, actingAsSecret());
}

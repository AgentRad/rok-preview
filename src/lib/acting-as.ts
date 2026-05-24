import "server-only";
import { cookies } from "next/headers";

/**
 * Admin "act as supplier" cookie. When set, getActiveSupplierContext returns
 * that supplier (as OWNER) for admin users, so the existing supplier endpoints
 * and dashboard work end-to-end without duplicating routes.
 *
 * The cookie is httpOnly and short-lived. Clearing is just deleting the
 * cookie or calling clearActingAsSupplier().
 */
const COOKIE = "pp_acting_as";

export async function setActingAsSupplier(supplierId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, supplierId, {
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

export async function getActingAsSupplier(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE)?.value || null;
}

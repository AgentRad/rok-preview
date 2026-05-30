import "server-only";
import { prisma } from "./db";

/**
 * PLH-3c F1: soft brand model. Product.manufacturer must match a
 * MANUFACTURER user's claimed manufacturerName (case-insensitive). This
 * prevents suppliers from minting phantom brands by free-typing a name.
 *
 * NOTE: PLH-3c F3 later layers an APPROVED-application gate on top of
 * this query. The implementation here is kept simple so F3 can extend
 * it without breaking F1's contract.
 */

export async function listClaimedManufacturers(): Promise<string[]> {
  // PLH-3c F3: only surface MANUFACTURER users whose
  // ManufacturerApplication is APPROVED. Unapproved brands are invisible
  // to suppliers (so the dropdown can't be used to launder a phantom
  // brand into the catalog) and invisible to buyers (storefront 404).
  const rows = await prisma.user.findMany({
    where: {
      role: "MANUFACTURER",
      manufacturerName: { not: null },
      // PLH-3w P1: hide suspended/banned OEM brands.
      status: "ACTIVE",
      manufacturerApplication: { status: "APPROVED" },
    },
    select: { manufacturerName: true },
  });
  const set = new Set<string>();
  for (const r of rows) {
    const n = (r.manufacturerName || "").trim();
    if (n) set.add(n);
  }
  return Array.from(set).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

export async function isClaimedManufacturer(name: string): Promise<boolean> {
  const trimmed = (name || "").trim();
  if (!trimmed) return false;
  const row = await prisma.user.findFirst({
    where: {
      role: "MANUFACTURER",
      manufacturerName: { equals: trimmed, mode: "insensitive" },
      // PLH-3w P1: hide suspended/banned OEM brands.
      status: "ACTIVE",
      manufacturerApplication: { status: "APPROVED" },
    },
    select: { id: true },
  });
  return !!row;
}

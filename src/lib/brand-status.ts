import "server-only";
import { prisma } from "./db";
import { manufacturerSlug } from "./manufacturer-slug";

/**
 * Server-side recompute of the brand-mismatch state for an OEM user.
 *
 * Background: PATCH /api/account/profile returns a `warning` field when
 * the OEM's manufacturerName has no matching Product.manufacturer (empty
 * storefront). That warning was only ever stored in client state; a
 * reload of /settings or /oem made it disappear, even though the
 * underlying mismatch was still real.
 *
 * This helper rederives the warning from current data so server-rendered
 * pages can surface it persistently. Returns null when the brand name
 * matches an existing product manufacturer, or when the user isn't an OEM.
 */
export type BrandMismatchWarning = {
  /** Human-readable message shown to the OEM in an info alert. */
  message: string;
  /** Canonical name we'd recommend (slug-matched or current). */
  suggestion: string | null;
};

export async function recomputeBrandMismatch(args: {
  role: string;
  manufacturerName: string | null;
}): Promise<BrandMismatchWarning | null> {
  if (args.role !== "MANUFACTURER") return null;
  if (!args.manufacturerName) return null;
  const slug = manufacturerSlug(args.manufacturerName);
  const productManufacturers = await prisma.product.findMany({
    where: { active: true },
    select: { manufacturer: true },
    distinct: ["manufacturer"],
  });
  const exact = productManufacturers.find(
    (p) => manufacturerSlug(p.manufacturer) === slug
  );
  if (exact) {
    // Name slug-matches a real product manufacturer. If it's not byte-identical
    // (e.g. "Schneider Electric Inc" vs "Schneider Electric"), surface a
    // softer warning suggesting the canonical form.
    if (exact.manufacturer !== args.manufacturerName) {
      return {
        message: `Your storefront name is "${args.manufacturerName}", but products on PartsPort are listed under "${exact.manufacturer}". Consider matching that name exactly so your storefront lights up.`,
        suggestion: exact.manufacturer,
      };
    }
    return null;
  }
  return {
    message: `No products on PartsPort match "${args.manufacturerName}" yet. Your storefront will be empty until a distributor lists products with this exact manufacturer name. Double-check the spelling, or contact support if you expect existing listings to roll up to your brand.`,
    suggestion: null,
  };
}

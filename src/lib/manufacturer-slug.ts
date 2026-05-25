/**
 * Manufacturer name -> URL slug. Goal: stable, lower-case, URL-safe,
 * AND distinct between brands whose only difference is a special char
 * (the previous strip-all-special approach collided "S&C" with "SC" and
 * "Landis+Gyr" with "LandisGyr").
 *
 * Rules:
 *  - normalize NFKD, strip combining marks
 *  - lower-case
 *  - "&" -> "-and-"
 *  - "+" -> "-plus-"
 *  - everything else not [a-z0-9] -> "-"
 *  - collapse runs of "-"
 *  - trim leading / trailing "-"
 *
 * Examples:
 *   "Schneider Electric"  -> "schneider-electric"
 *   "S&C Electric"        -> "s-and-c-electric"
 *   "Landis+Gyr"          -> "landis-plus-gyr"
 *   "Q-Cells"             -> "q-cells"
 *   "SC"                  -> "sc"            (no collision with S&C)
 *
 * Once the OEM table has a stored slug column, this will become a
 * fallback used only at name-normalization time.
 */
export function manufacturerSlug(name: string): string {
  return name
    .normalize("NFKD")
    // Strip combining marks (̀-ͯ)
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "-and-")
    .replace(/\+/g, "-plus-")
    // Anything not [a-z0-9] becomes a dash
    .replace(/[^a-z0-9]+/g, "-")
    // Collapse multiple dashes
    .replace(/-+/g, "-")
    // Trim leading/trailing dashes
    .replace(/^-|-$/g, "");
}

/**
 * Normalize a manufacturer name to a canonical form used for matching
 * against existing Product.manufacturer values. Whitespace-trimmed,
 * single-spaced, but preserves case. Use this when comparing OEM signup
 * input to known brand names.
 */
export function canonicalizeManufacturerName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

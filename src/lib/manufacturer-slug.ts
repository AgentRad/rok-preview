/**
 * Manufacturer name -> URL slug.
 *
 * Used for public storefront URLs at /manufacturers/[slug] without needing
 * a stored slug column. Lower-case, strip diacritics, replace non-alpha
 * with dashes, collapse runs, trim. "Schneider Electric" -> "schneider-electric".
 * "Q-Cells" stays "q-cells". "S&C Electric" -> "sc-electric" (ampersand drops).
 */
export function manufacturerSlug(name: string): string {
  return name
    .normalize("NFKD")
    // Strip combining marks
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Anything not [a-z0-9] becomes a dash
    .replace(/[^a-z0-9]+/g, "-")
    // Collapse multiple dashes
    .replace(/-+/g, "-")
    // Trim leading/trailing dashes
    .replace(/^-|-$/g, "");
}

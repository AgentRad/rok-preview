/**
 * Resolve the single image URL to use when only one image slot exists
 * (catalog card, cart line, checkout summary, order detail, OEM
 * storefront tile, etc.).
 *
 * Order of preference:
 *   1. The first ProductImage by ordinal (i.e. the primary upload)
 *   2. The legacy Product.imageUrl scalar
 *   3. null (caller renders a PartIcon fallback)
 *
 * PLH-3h Phase 1 backfilled every existing Product.imageUrl into a
 * ProductImage row, so case 1 covers all seeded data. Case 2 is the
 * safety net for any code path that hasn't yet been migrated to
 * include `images`. Case 3 lets the existing PartIcon fallback keep
 * working with zero behavior change.
 */
export type ProductImageLike = { url: string; ordinal?: number };

export function primaryImageUrl(product: {
  images?: ProductImageLike[] | null;
  imageUrl?: string | null;
}): string | null {
  const imgs = product.images;
  if (imgs && imgs.length > 0) {
    // Defensive: the caller should have ordered by ordinal asc, but
    // sort here too so the helper is correct in isolation.
    const sorted = [...imgs].sort(
      (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)
    );
    if (sorted[0]?.url) return sorted[0].url;
  }
  if (product.imageUrl) return product.imageUrl;
  return null;
}

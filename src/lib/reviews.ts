import "server-only";
import { prisma } from "./db";

/** Suppliers below this threshold display a "New supplier" badge instead
 *  of a (statistically meaningless) computed star rating. */
export const MIN_REVIEWS_FOR_RATING = 5;

export type SupplierRatingSummary =
  | { kind: "new"; count: 0 }
  | { kind: "computed"; average: number; count: number };

/** Aggregated rating across every visible review of every product this
 *  supplier sells. Hidden reviews are excluded. */
export async function supplierRatingSummary(
  supplierId: string
): Promise<SupplierRatingSummary> {
  const agg = await prisma.review.aggregate({
    where: { supplierId, hiddenAt: null },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const count = agg._count._all;
  if (count < MIN_REVIEWS_FOR_RATING) return { kind: "new", count: 0 };
  return {
    kind: "computed",
    average: agg._avg.rating ?? 0,
    count,
  };
}

/** Same shape, but for a single product. Used on the product page. */
export async function productRatingSummary(productId: string): Promise<{
  average: number;
  count: number;
}> {
  const agg = await prisma.review.aggregate({
    where: { productId, hiddenAt: null },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return { average: agg._avg.rating ?? 0, count: agg._count._all };
}

/** "Jordan B." format for a buyer display name, never the email. */
export function displayBuyerName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return "PartsPort buyer";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

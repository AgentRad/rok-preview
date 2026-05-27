import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import type { User } from "@prisma/client";
import { canEditCatalog, effectiveAccessToSupplier } from "@/lib/supplier-access";

export const MAX_IMAGES_PER_PRODUCT = 12;

export type ProductImageAuthResult =
  | { error: NextResponse; user?: undefined; product?: undefined }
  | {
      error?: undefined;
      user: User;
      product: { id: string; supplierId: string };
    };

/**
 * Shared auth gate for /api/supplier/products/[id]/images/* routes.
 * Suppliers must own (or be a canEditCatalog member of) the supplier;
 * admins bypass ownership.
 */
export async function authorizeProductEdit(
  productId: string
): Promise<ProductImageAuthResult> {
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
    return { error: NextResponse.json({ error: "Not authorized." }, { status: 403 }) };
  }
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, supplierId: true },
  });
  if (!product) {
    return { error: NextResponse.json({ error: "Product not found." }, { status: 404 }) };
  }
  if (user.role !== "ADMIN") {
    const access = await effectiveAccessToSupplier(user, product.supplierId);
    if (!access.ok || !canEditCatalog(access.role)) {
      return { error: NextResponse.json({ error: "Not your product." }, { status: 403 }) };
    }
  }
  return { user, product };
}

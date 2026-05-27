import "server-only";
import { prisma } from "@/lib/db";
import { snapshotConnect } from "@/lib/stripe-connect";
import { computeReadiness } from "@/lib/supplier-access";

// PLH-3l P2: shared data loaders used by the dashboard and the sub-routes
// after the IA split. Each loader is bounded by supplierId and returns the
// minimum needed by the matching section component.

export async function loadSupplierWithProducts(supplierId: string) {
  return prisma.supplier.findUnique({
    where: { id: supplierId },
    include: { products: { orderBy: { createdAt: "asc" } } },
  });
}

export async function loadSupplierDocuments(supplierId: string) {
  return prisma.supplierDocument.findMany({
    where: { supplierId },
    orderBy: [{ uploadedAt: "desc" }],
  });
}

export async function loadSupplierWarehouses(supplierId: string) {
  return prisma.supplierWarehouse.findMany({
    where: { supplierId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

export async function loadSupplierOrders(supplierId: string) {
  return prisma.order.findMany({
    where: {
      items: { some: { product: { supplierId } } },
      status: { in: ["PAID", "FULFILLED"] },
    },
    include: {
      items: { include: { product: true } },
      supplierSlots: { where: { supplierId } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function loadSupplierQuotes(supplierId: string) {
  return prisma.quoteRequest.findMany({
    where: {
      product: { supplierId },
      status: { in: ["OPEN", "QUOTED"] },
    },
    include: { product: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function loadSupplierPayouts(supplierId: string) {
  return prisma.payout.findMany({
    where: { supplierId },
    include: { order: { select: { reference: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export async function loadSupplierReserveTxns(supplierId: string) {
  return prisma.supplierReserveTransaction.findMany({
    where: { supplierId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}

export type SupplierWithProducts = NonNullable<
  Awaited<ReturnType<typeof loadSupplierWithProducts>>
>;

export function computeSupplierReadiness(
  supplier: SupplierWithProducts,
  documents: Awaited<ReturnType<typeof loadSupplierDocuments>>
) {
  return computeReadiness(
    {
      status: supplier.status,
      logoUrl: supplier.logoUrl,
      description: supplier.description,
      certifications: supplier.certifications,
      website: supplier.website,
      bankInfoStatus: supplier.bankInfoStatus,
      stripePayoutsEnabled: supplier.stripePayoutsEnabled,
      stripeAccountId: supplier.stripeAccountId,
    },
    documents.map((d) => ({ kind: d.kind, status: d.status })),
    supplier.products.length
  );
}

export function getConnectSnap(supplier: SupplierWithProducts) {
  return snapshotConnect(supplier);
}

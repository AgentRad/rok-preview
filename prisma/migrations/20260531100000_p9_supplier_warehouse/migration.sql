-- SupplierWarehouse: origin zips for real-rate freight quoting. Multiple
-- warehouses per supplier; one is flagged isDefault and drives the
-- checkout-time freight quote when the cart has items from that supplier.

CREATE TABLE "SupplierWarehouse" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT '',
  "zip" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierWarehouse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierWarehouse_supplierId_idx" ON "SupplierWarehouse"("supplierId");

ALTER TABLE "SupplierWarehouse"
  ADD CONSTRAINT "SupplierWarehouse_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

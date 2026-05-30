-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: mirror legacy Product.imageUrl into ProductImage as position 0
-- so existing photos surface in the new gallery without a separate import.
INSERT INTO "ProductImage" ("id", "productId", "url", "position", "createdAt")
SELECT
  'pi-' || "id" AS id,
  "id" AS "productId",
  "imageUrl" AS url,
  0 AS position,
  CURRENT_TIMESTAMP AS "createdAt"
FROM "Product"
WHERE "imageUrl" IS NOT NULL AND "imageUrl" <> '';

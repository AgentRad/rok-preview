-- PLH-3h P1: ProductImage model aligned to (productId, ordinal) unique +
-- alt text. The table was created in 20260525000000_product_images with a
-- "position" column and a non-unique index. This migration reshapes that
-- table to match the canonical PLH-3h schema, and reseeds any Product rows
-- with a non-null imageUrl that don't yet have a ProductImage row (the
-- initial seed from the deprecated Product.imageUrl column).

-- Rename "position" -> "ordinal" so callers use the canonical field name.
ALTER TABLE "ProductImage" RENAME COLUMN "position" TO "ordinal";

-- Drop the legacy default; ordinals are always assigned explicitly now.
ALTER TABLE "ProductImage" ALTER COLUMN "ordinal" DROP DEFAULT;

-- Add alt text column. Empty string default keeps existing rows valid.
ALTER TABLE "ProductImage" ADD COLUMN "alt" TEXT NOT NULL DEFAULT '';

-- Swap the non-unique single-column index for the canonical composite +
-- the (productId, ordinal) unique constraint. DROP IF EXISTS keeps this
-- safe across environments where the original index name differs.
DROP INDEX IF EXISTS "ProductImage_productId_idx";
CREATE INDEX "ProductImage_productId_ordinal_idx" ON "ProductImage"("productId", "ordinal");
CREATE UNIQUE INDEX "ProductImage_productId_ordinal_key" ON "ProductImage"("productId", "ordinal");

-- PLH-3h initial seed from the deprecated Product.imageUrl column. The
-- 20260525000000_product_images migration already covered existing rows;
-- this re-runs as a safety net for any Product rows added in between, and
-- is a no-op when the prior backfill already inserted the row (matched
-- via the new unique index). gen_random_uuid() requires pgcrypto, which
-- Neon ships enabled by default; the fallback md5(random()) form is kept
-- inline as a comment in case a future environment lacks the extension.
INSERT INTO "ProductImage" ("id", "productId", "url", "alt", "ordinal", "createdAt")
SELECT
  'pim_' || REPLACE(gen_random_uuid()::text, '-', '') AS id,
  p."id" AS "productId",
  p."imageUrl" AS url,
  '' AS alt,
  0 AS ordinal,
  CURRENT_TIMESTAMP AS "createdAt"
FROM "Product" p
WHERE p."imageUrl" IS NOT NULL
  AND p."imageUrl" <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "ProductImage" pi
    WHERE pi."productId" = p."id" AND pi."ordinal" = 0
  );
-- Fallback id form if pgcrypto unavailable:
--   'pim_' || md5(random()::text || clock_timestamp()::text)

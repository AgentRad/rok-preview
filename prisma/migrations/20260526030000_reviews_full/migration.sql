-- Add title, orderId, and moderation fields to Review. Switch unique
-- constraint to allow one review per buyer per product per order (a buyer
-- who ordered the same part twice can review each shipment).
--
-- Existing rows (if any) won't have an orderId yet. To stay safe we backfill
-- it from the buyer's most recent FULFILLED order that included the product,
-- and drop any review where no eligible order can be found.

ALTER TABLE "Review"
  ADD COLUMN "orderId"      TEXT,
  ADD COLUMN "title"        TEXT NOT NULL DEFAULT '',
  ADD COLUMN "hiddenAt"     TIMESTAMP(3),
  ADD COLUMN "hiddenReason" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "hiddenById"   TEXT;

-- Backfill orderId from the most recent FULFILLED order for the buyer that
-- contains the same product. NULL out where we can't find one.
UPDATE "Review" r
SET "orderId" = (
  SELECT o."id"
  FROM "Order" o
  JOIN "OrderItem" oi ON oi."orderId" = o."id"
  WHERE o."buyerId" = r."buyerId"
    AND oi."productId" = r."productId"
    AND o."status" = 'FULFILLED'
  ORDER BY o."paidAt" DESC NULLS LAST
  LIMIT 1
);

-- Reviews with no resolvable order can't be trusted as verified buyer
-- reviews under the new model, so drop them.
DELETE FROM "Review" WHERE "orderId" IS NULL;

-- Now require orderId and add the FK / index.
ALTER TABLE "Review" ALTER COLUMN "orderId" SET NOT NULL;

ALTER TABLE "Review"
  ADD CONSTRAINT "Review_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Review_orderId_idx" ON "Review"("orderId");

-- Switch the unique constraint from (buyer, product) to (buyer, product, order).
DROP INDEX "Review_buyerId_productId_key";
CREATE UNIQUE INDEX "Review_buyerId_productId_orderId_key"
  ON "Review"("buyerId", "productId", "orderId");

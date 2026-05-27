-- PLH-3a B1: add Order.shippedAt and backfill historical orders.
--
-- New column is nullable; markOrderShipped() in src/lib/shipping.ts stamps
-- it on the actual PAID -> Shipped transition going forward. The backfill
-- below is a best-effort estimate for historical rows so supplier-health
-- has non-null data the day this ships. It is NOT real ship-time data:
-- pre-PLH-3a we did not record when the supplier actually clicked Mark
-- Shipped, so the backfill uses paidAt + 1 day as a stand-in. Once a few
-- weeks of real shippedAt data accumulates the supplier-health rolling
-- 30-day window will be driven entirely by real values.

ALTER TABLE "Order" ADD COLUMN "shippedAt" TIMESTAMP(3);

-- Backfill estimate: assume one day from payment to ship for any order
-- already past the Shipped stage. Idempotent guard on shippedAt IS NULL.
UPDATE "Order"
SET "shippedAt" = "paidAt" + INTERVAL '1 day'
WHERE "shipmentStage" IN ('Shipped', 'Delivered')
  AND "shippedAt" IS NULL
  AND "paidAt" IS NOT NULL;

-- PLH-3c F5: track real delivery timestamp on Order so the 30-day
-- post-delivery return window has a real anchor instead of approximating
-- against paidAt or shipmentStage.

ALTER TABLE "Order" ADD COLUMN "deliveredAt" TIMESTAMP(3);

-- Backfill: historical Delivered orders never recorded a real delivery
-- timestamp. Estimate as paidAt + 7 days for Delivered/FULFILLED rows so
-- the 30-day return window has *some* anchor for existing data. This is
-- an estimate; new orders get the real value stamped from shipping/order
-- transition helpers.
UPDATE "Order"
   SET "deliveredAt" = "paidAt" + INTERVAL '7 days'
 WHERE "deliveredAt" IS NULL
   AND "paidAt" IS NOT NULL
   AND ("shipmentStage" = 'Delivered' OR "status" = 'FULFILLED');

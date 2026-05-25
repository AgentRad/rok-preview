-- Order columns to record the buyer's freight selection at checkout.
-- freightCarrier + freightService: the chosen rate's label, surfaced on
-- the order detail, invoice, and shipped email. freightBreakdown: per-
-- supplier-shipment array when the cart spans multiple suppliers (Polish
-- 9 S3). freightSurcharges: liftgate/residential/inside-delivery flags
-- (Polish 9 S4) as JSON so new surcharge types don't need a migration.

ALTER TABLE "Order" ADD COLUMN "freightCarrier"    TEXT;
ALTER TABLE "Order" ADD COLUMN "freightService"    TEXT;
ALTER TABLE "Order" ADD COLUMN "freightBreakdown"  JSONB;
ALTER TABLE "Order" ADD COLUMN "freightSurcharges" JSONB;

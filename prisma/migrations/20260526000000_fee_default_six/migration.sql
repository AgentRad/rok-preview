-- Change Order.feeRateBps default from 400 (4%) to 600 (6%). Existing rows
-- keep whatever rate was snapshot at order creation time, so historical
-- orders / invoices remain accurate.
ALTER TABLE "Order" ALTER COLUMN "feeRateBps" SET DEFAULT 600;

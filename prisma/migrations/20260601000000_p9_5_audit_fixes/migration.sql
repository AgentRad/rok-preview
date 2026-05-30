-- Polish 9.5 audit fixes: order idempotency, multi-supplier label
-- storage, refund-shortfall netting. Single atomic migration because the
-- columns are tightly related to the route fixes shipped alongside.

-- CRIT 8: server-side idempotency on Order. Hash of (header or body
-- idempotency-key) + buyerId or email. Two identical POSTs collide on
-- the unique index; second POST returns the existing order id.
ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- HIGH 20 / CRIT 4: multi-supplier label storage. JSON array of
-- { supplierId, labelUrl, trackingNumber, carrier, service, transactionId }
-- so multi-supplier orders track one label per shipment. Single-supplier
-- orders continue to use top-level carrier + trackingCode for backward
-- compatibility.
ALTER TABLE "Order" ADD COLUMN "shippoLabels" JSONB;

-- CRIT 5: refund clawback netting. When a refund exceeds available
-- supplier reserve (60+ day-old orders), the shortfall accumulates here
-- and is netted against future payouts in lib/payouts.ts.
ALTER TABLE "Supplier" ADD COLUMN "owedToPlatformCents" INTEGER NOT NULL DEFAULT 0;

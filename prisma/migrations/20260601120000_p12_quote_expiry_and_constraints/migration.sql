-- Polish 12 commit 3: HIGH issues H1, H2, H8.

-- H1: per-quote expiry. Defaults are set at write-time in the PATCH
-- route (NOW + 30d when the supplier prices the quote).
ALTER TABLE "QuoteRequest" ADD COLUMN "quoteExpiresAt" TIMESTAMP(3);

-- H2: unique index on QuoteRequest.orderId. Two /accept-from-checkout
-- POSTs racing to create an Order both write into QuoteRequest.orderId;
-- the loser hits P2002 and returns the winner's order id idempotently.
-- Filtered unique so the existing null-orderId rows don't collide.
CREATE UNIQUE INDEX "QuoteRequest_orderId_key" ON "QuoteRequest"("orderId") WHERE "orderId" IS NOT NULL;

-- H8: keep supplier balance fields non-negative. The lib/refunds.ts
-- shortfall path and lib/payouts.ts owed-recovery path both decrement,
-- and a stale-read race could push the value below zero. Re-fetch +
-- Math.min inside the transaction is the primary guard; this CHECK is
-- the belt for the suspenders.
ALTER TABLE "Supplier" ADD CONSTRAINT "supplier_owed_nonneg" CHECK ("owedToPlatformCents" >= 0);
ALTER TABLE "Supplier" ADD CONSTRAINT "supplier_reserve_nonneg" CHECK ("reserveBalanceCents" >= 0);

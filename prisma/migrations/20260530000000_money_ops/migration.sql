-- Polish 8 money operations: Stripe Connect Express, automatic
-- supplier payouts, chargeback reserve, refunds, tax registration
-- tracking. Single migration because the new fields and tables are
-- interdependent (Payout gains stripeTransferId + reservedCents;
-- Order gains stripePaymentIntentId + refundedCents + reservedCents;
-- SupplierReserveTransaction and Refund are new); shipping them
-- atomically avoids a half-migrated production state.

-- Enums: PayoutStatus gains PROCESSING + FAILED; OrderStatus gains REFUNDED.
ALTER TYPE "PayoutStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "PayoutStatus" ADD VALUE 'FAILED';
ALTER TYPE "OrderStatus" ADD VALUE 'REFUNDED';

-- Supplier: Stripe Connect Express + chargeback reserve fields.
ALTER TABLE "Supplier" ADD COLUMN "stripeAccountId" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Supplier" ADD COLUMN "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Supplier" ADD COLUMN "stripeOnboardingCompletedAt" TIMESTAMP(3);
ALTER TABLE "Supplier" ADD COLUMN "reservePercent" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "Supplier" ADD COLUMN "reserveBalanceCents" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "Supplier_stripeAccountId_key" ON "Supplier"("stripeAccountId");

-- Payout: Stripe transfer linkage + retry state + reserve tracking.
ALTER TABLE "Payout" ADD COLUMN "reservedCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payout" ADD COLUMN "stripeTransferId" TEXT;
ALTER TABLE "Payout" ADD COLUMN "retryAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payout" ADD COLUMN "lastRetryAt" TIMESTAMP(3);
ALTER TABLE "Payout" ADD COLUMN "failureReason" TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX "Payout_stripeTransferId_key" ON "Payout"("stripeTransferId");

-- Order: Stripe PI capture + refund + reserve totals.
ALTER TABLE "Order" ADD COLUMN "stripePaymentIntentId" TEXT;
ALTER TABLE "Order" ADD COLUMN "refundedCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "reservedCents" INTEGER NOT NULL DEFAULT 0;

-- SupplierReserveTransaction: HOLD / RELEASE / DRAW_DOWN history.
CREATE TABLE "SupplierReserveTransaction" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "orderId" TEXT,
  "reason" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierReserveTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierReserveTransaction_supplierId_idx" ON "SupplierReserveTransaction"("supplierId");
CREATE INDEX "SupplierReserveTransaction_orderId_idx" ON "SupplierReserveTransaction"("orderId");

-- Refund: one row per Stripe refund call; rolling total mirrored on Order.
CREATE TABLE "Refund" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "stripeRefundId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "returnRequestId" TEXT,
  "refundedBy" TEXT,
  "status" TEXT NOT NULL DEFAULT 'succeeded',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Refund_stripeRefundId_key" ON "Refund"("stripeRefundId");
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");
CREATE INDEX "Refund_returnRequestId_idx" ON "Refund"("returnRequestId");

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TaxRegistration: per-state remittance tracking (S9).
CREATE TABLE "TaxRegistration" (
  "id" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "registrationStatus" TEXT NOT NULL,
  "registeredAt" TIMESTAMP(3),
  "nextFilingDue" TIMESTAMP(3),
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxRegistration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaxRegistration_state_key" ON "TaxRegistration"("state");

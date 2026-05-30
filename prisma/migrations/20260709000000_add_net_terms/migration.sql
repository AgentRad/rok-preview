-- PLH-3z-1: net-terms invoice plumbing.

-- New payment terms enum.
CREATE TYPE "PaymentTerms" AS ENUM ('PREPAID', 'NET_15', 'NET_30', 'NET_60');

-- Extend the invoice status enum with net-terms lifecycle values.
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'DUE';
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'PAST_DUE';

-- Org-level terms + manual credit limit.
ALTER TABLE "BuyerOrg" ADD COLUMN "paymentTerms" "PaymentTerms" NOT NULL DEFAULT 'PREPAID';
ALTER TABLE "BuyerOrg" ADD COLUMN "creditLimitCents" INTEGER;

-- Per-order snapshot of the terms in effect + invoice due date for net orders.
ALTER TABLE "Order" ADD COLUMN "paymentTerms" "PaymentTerms" NOT NULL DEFAULT 'PREPAID';
ALTER TABLE "Order" ADD COLUMN "invoiceDueDate" TIMESTAMP(3);

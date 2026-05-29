-- PLH-3z-2: Stripe Invoices + payment recording.

-- Extend the invoice status enum with the Stripe uncollectible write-off state.
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'UNCOLLECTIBLE';

-- Invoice collection columns. stripeInvoiceId is unique (one Stripe Invoice per
-- local invoice); the rest stamp settlement state.
ALTER TABLE "Invoice" ADD COLUMN "stripeInvoiceId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN "paidReference" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "partialPaidCents" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "Invoice_stripeInvoiceId_key" ON "Invoice"("stripeInvoiceId");

-- partialPaidCents is a running sum of applied payments; never negative.
ALTER TABLE "Invoice" ADD CONSTRAINT "invoice_partial_paid_nonneg" CHECK ("partialPaidCents" >= 0);

-- Payment records: one row per payment applied to an invoice.
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "recordedBy" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentRecord_invoiceId_idx" ON "PaymentRecord"("invoiceId");

ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

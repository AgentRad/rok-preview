-- PLH-3z-4: dunning + auto-suspend + payout policy (final net-30 round).

-- Org-level credit suspension status.
CREATE TYPE "BuyerOrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

ALTER TABLE "BuyerOrg" ADD COLUMN "status" "BuyerOrgStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "BuyerOrg" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "BuyerOrg" ADD COLUMN "suspendedReason" TEXT;

-- Stripe-hosted invoice URL for self-service dunning pay links.
ALTER TABLE "Invoice" ADD COLUMN "stripeHostedInvoiceUrl" TEXT;

-- Dunning idempotency table: one row per (invoice, stage).
CREATE TABLE "InvoiceDunningLog" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceDunningLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceDunningLog_invoiceId_stage_key" ON "InvoiceDunningLog"("invoiceId", "stage");
CREATE INDEX "InvoiceDunningLog_invoiceId_idx" ON "InvoiceDunningLog"("invoiceId");

ALTER TABLE "InvoiceDunningLog" ADD CONSTRAINT "InvoiceDunningLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Address" ADD COLUMN "taxExemptCertificateUrl" TEXT,
ADD COLUMN "taxExemptStatus" TEXT DEFAULT 'PENDING';

-- Index for faster lookups
CREATE INDEX "Address_taxExemptStatus_idx" ON "Address"("taxExemptStatus");

-- Supplier onboarding infrastructure: legal documents, bank info summary,
-- and a public-visibility gate that keeps non-onboarded suppliers off the
-- public catalog until admin flips them live.

-- 1. Public visibility flag. Existing APPROVED suppliers stay visible (the
--    demo catalog should not disappear on deploy); brand-new suppliers
--    default to hidden until they finish onboarding.
ALTER TABLE "Supplier" ADD COLUMN "publicVisible" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Supplier" SET "publicVisible" = true WHERE "status" = 'APPROVED';

-- 2. Payout method summary. Full account/routing numbers are NEVER stored
--    here; suppliers send those via secure channel. last4 + bank name is
--    surfaced to the supplier so they can confirm it matches what they sent.
ALTER TABLE "Supplier" ADD COLUMN "bankInfoStatus" TEXT NOT NULL DEFAULT 'MISSING';
ALTER TABLE "Supplier" ADD COLUMN "bankInfoLast4" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "bankInfoType" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "bankInfoBankName" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "bankInfoNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Supplier" ADD COLUMN "bankInfoUpdatedAt" TIMESTAMP(3);

-- 3. Legal documents (W9, signed supplier agreement, certificate of
--    insurance, free-form other). One row per uploaded artifact; the
--    onboarding checklist treats each kind as a slot and looks for an
--    APPROVED row of that kind.
CREATE TABLE "SupplierDocument" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewNote" TEXT NOT NULL DEFAULT '',
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierDocument_supplierId_idx" ON "SupplierDocument"("supplierId");
CREATE INDEX "SupplierDocument_status_idx" ON "SupplierDocument"("status");

ALTER TABLE "SupplierDocument"
  ADD CONSTRAINT "SupplierDocument_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

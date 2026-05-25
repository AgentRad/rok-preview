-- Buyer company profile: shown on checkout / order detail / invoice
-- when the logged-in buyer has filled it in. Snapshotted onto the Order
-- at creation time so old invoices keep their original branding.
ALTER TABLE "User"
  ADD COLUMN "companyName" TEXT,
  ADD COLUMN "companyLogoUrl" TEXT;

ALTER TABLE "Order"
  ADD COLUMN "buyerCompanyName" TEXT,
  ADD COLUMN "buyerCompanyLogoUrl" TEXT;

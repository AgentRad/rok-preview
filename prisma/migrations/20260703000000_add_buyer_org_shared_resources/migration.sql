-- PLH-3y-2: org-level shared resources + billing modes.
--
-- BuyerOrg gains a billing mode (MEMBER_PAYS default, HYBRID adds an optional
-- org-level Stripe Customer) plus a lifted org-level tax-exempt cert (mirrors
-- the per-Address cert fields from PLH-3j P4). New BuyerOrgAddress holds shared
-- shipping addresses any member can select at checkout; ADMIN manages them.

CREATE TYPE "BuyerOrgBillingMode" AS ENUM ('MEMBER_PAYS', 'HYBRID');

ALTER TABLE "BuyerOrg" ADD COLUMN "billingMode" "BuyerOrgBillingMode" NOT NULL DEFAULT 'MEMBER_PAYS';
ALTER TABLE "BuyerOrg" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "BuyerOrg" ADD COLUMN "taxExemptCertificateUrl" TEXT;
ALTER TABLE "BuyerOrg" ADD COLUMN "taxExemptStatus" TEXT;
ALTER TABLE "BuyerOrg" ADD COLUMN "taxExemptExpiresAt" TIMESTAMP(3);

CREATE TABLE "BuyerOrgAddress" (
    "id" TEXT NOT NULL,
    "buyerOrgId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "recipient" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "line1" TEXT NOT NULL,
    "line2" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "phone" TEXT NOT NULL DEFAULT '',
    "addedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "BuyerOrgAddress_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BuyerOrgAddress_buyerOrgId_deletedAt_idx" ON "BuyerOrgAddress"("buyerOrgId", "deletedAt");

ALTER TABLE "BuyerOrgAddress" ADD CONSTRAINT "BuyerOrgAddress_buyerOrgId_fkey" FOREIGN KEY ("buyerOrgId") REFERENCES "BuyerOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

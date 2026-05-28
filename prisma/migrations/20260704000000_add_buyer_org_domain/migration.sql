-- PLH-3y-3: domain auto-join + DNS verification.
--
-- BuyerOrgDomain holds a claimed email domain per org. An admin claims a
-- domain, the system mints a verificationToken, the admin adds a DNS TXT
-- record, and the verify-org-domains cron confirms it and flips status to
-- VERIFIED. Once VERIFIED and autoJoinEnabled is true, a new user registering
-- with an email at this domain is auto-added as a member with autoJoinRole.

CREATE TYPE "BuyerOrgDomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

CREATE TABLE "BuyerOrgDomain" (
    "id" TEXT NOT NULL,
    "buyerOrgId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verificationToken" TEXT NOT NULL,
    "status" "BuyerOrgDomainStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "txtLastCheckedAt" TIMESTAMP(3),
    "autoJoinEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoJoinRole" "BuyerOrgRole" NOT NULL DEFAULT 'VIEWER',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BuyerOrgDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BuyerOrgDomain_domain_key" ON "BuyerOrgDomain"("domain");
CREATE INDEX "BuyerOrgDomain_buyerOrgId_idx" ON "BuyerOrgDomain"("buyerOrgId");
CREATE INDEX "BuyerOrgDomain_status_idx" ON "BuyerOrgDomain"("status");

ALTER TABLE "BuyerOrgDomain" ADD CONSTRAINT "BuyerOrgDomain_buyerOrgId_fkey" FOREIGN KEY ("buyerOrgId") REFERENCES "BuyerOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

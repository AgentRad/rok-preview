-- PLH-3z-3: net-terms credit applications.

CREATE TABLE "CreditApplication" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "orgId" TEXT,
    "submittedByUserId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "dba" TEXT,
    "ein" TEXT NOT NULL,
    "yearsInBusiness" INTEGER,
    "expectedMonthlyCents" INTEGER NOT NULL,
    "requestedLimitCents" INTEGER NOT NULL,
    "requestedTerms" "PaymentTerms" NOT NULL,
    "billingAddress" TEXT NOT NULL,
    "apContactName" TEXT NOT NULL,
    "apContactEmail" TEXT NOT NULL,
    "apContactPhone" TEXT,
    "references" JSONB NOT NULL,
    "w9BlobUrl" TEXT,
    "dunsNumber" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewerNote" TEXT NOT NULL DEFAULT '',
    "approvedLimitCents" INTEGER,
    "approvedTerms" "PaymentTerms",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditApplication_reference_key" ON "CreditApplication"("reference");
CREATE INDEX "CreditApplication_orgId_idx" ON "CreditApplication"("orgId");
CREATE INDEX "CreditApplication_status_idx" ON "CreditApplication"("status");

ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "BuyerOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

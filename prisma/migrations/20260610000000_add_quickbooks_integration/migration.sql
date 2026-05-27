-- PLH-3i P1: Intuit QuickBooks Online integration.
--
-- Adds the IntegrationCredential table (one row per (provider, realmId)
-- pair; PartsPort currently only uses provider="quickbooks_online" but
-- the column is free-form so future integrations can share the table),
-- plus the per-record QBO id fields on User and Invoice.

CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "connectedByUserId" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationCredential_provider_realmId_key"
    ON "IntegrationCredential"("provider", "realmId");

ALTER TABLE "User" ADD COLUMN "qboCustomerId" TEXT;

ALTER TABLE "Invoice" ADD COLUMN "qboInvoiceId" TEXT;

-- PLH-3y-5: OIDC + SCIM + cert rotation.
--
-- SsoConfig gains SCIM provisioning columns (the OIDC columns already exist
-- from the 3y-4 migration). scimTokenHash is the SHA-256 hex of the bearer
-- token, unique so a token maps to exactly one org. BuyerOrgMember gains a
-- soft deactivation timestamp set by SCIM deprovision (PATCH active=false /
-- DELETE); order history is preserved.

ALTER TABLE "SsoConfig" ADD COLUMN "scimEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SsoConfig" ADD COLUMN "scimTokenHash" TEXT;
ALTER TABLE "SsoConfig" ADD COLUMN "scimTokenLast4" TEXT;

CREATE UNIQUE INDEX "SsoConfig_scimTokenHash_key" ON "SsoConfig"("scimTokenHash");

ALTER TABLE "BuyerOrgMember" ADD COLUMN "deactivatedAt" TIMESTAMP(3);

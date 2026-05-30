-- PLH-3y-4: SAML SSO + JIT provisioning.
--
-- SsoConfig holds a per-org single sign-on configuration. SAML 2.0 ships this
-- round; the OIDC columns are present but unused until PLH-3y-5. SsoLoginEvent
-- is the high-volume per-login audit trail. BuyerOrgMember gains a per-member
-- break-glass flag for password login when the org enforces SSO.

CREATE TYPE "SsoIdpType" AS ENUM ('SAML', 'OIDC');

CREATE TABLE "SsoConfig" (
    "id" TEXT NOT NULL,
    "buyerOrgId" TEXT NOT NULL,
    "idpType" "SsoIdpType" NOT NULL DEFAULT 'SAML',
    "idpEntityId" TEXT,
    "idpSsoUrl" TEXT,
    "idpSloUrl" TEXT,
    "idpX509Cert" TEXT,
    "idpX509CertNext" TEXT,
    "oidcIssuer" TEXT,
    "oidcClientId" TEXT,
    "oidcClientSecret" TEXT,
    "domainAllowlist" TEXT[],
    "groupAttributeName" TEXT,
    "groupRoleMap" JSONB,
    "defaultRole" "BuyerOrgRole" NOT NULL DEFAULT 'BUYER',
    "enforced" BOOLEAN NOT NULL DEFAULT false,
    "sessionMaxAgeMin" INTEGER NOT NULL DEFAULT 480,
    "honorIdpSessionExpiry" BOOLEAN NOT NULL DEFAULT true,
    "configuredById" TEXT,
    "configuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedCertAt" TIMESTAMP(3),
    CONSTRAINT "SsoConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SsoConfig_buyerOrgId_key" ON "SsoConfig"("buyerOrgId");
CREATE INDEX "SsoConfig_buyerOrgId_idx" ON "SsoConfig"("buyerOrgId");

ALTER TABLE "SsoConfig" ADD CONSTRAINT "SsoConfig_buyerOrgId_fkey" FOREIGN KEY ("buyerOrgId") REFERENCES "BuyerOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SsoLoginEvent" (
    "id" TEXT NOT NULL,
    "buyerOrgId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SsoLoginEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SsoLoginEvent_buyerOrgId_createdAt_idx" ON "SsoLoginEvent"("buyerOrgId", "createdAt");
CREATE INDEX "SsoLoginEvent_email_createdAt_idx" ON "SsoLoginEvent"("email", "createdAt");

ALTER TABLE "SsoLoginEvent" ADD CONSTRAINT "SsoLoginEvent_buyerOrgId_fkey" FOREIGN KEY ("buyerOrgId") REFERENCES "BuyerOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BuyerOrgMember" ADD COLUMN "emergencyPasswordAccess" BOOLEAN NOT NULL DEFAULT false;

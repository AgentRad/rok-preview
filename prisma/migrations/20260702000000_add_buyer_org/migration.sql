-- PLH-3y-1: buyer organization foundation.
--
-- New BuyerOrgRole enum (ADMIN | APPROVER | BUYER | VIEWER). BuyerOrg holds
-- the org; BuyerOrgMember links users with a role; BuyerOrgInvite mirrors the
-- supplier invite pattern (hashed token, expiry, single pending invite per
-- email + org). User gains a nullable activeBuyerOrgId so the nav switcher can
-- record the currently-selected org. Admin-managed only this round.

CREATE TYPE "BuyerOrgRole" AS ENUM ('ADMIN', 'APPROVER', 'BUYER', 'VIEWER');

CREATE TABLE "BuyerOrg" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BuyerOrg_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BuyerOrgMember" (
    "id" TEXT NOT NULL,
    "buyerOrgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "BuyerOrgRole" NOT NULL DEFAULT 'BUYER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedByUserId" TEXT,
    CONSTRAINT "BuyerOrgMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BuyerOrgInvite" (
    "id" TEXT NOT NULL,
    "buyerOrgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "BuyerOrgRole" NOT NULL DEFAULT 'BUYER',
    "tokenHash" TEXT NOT NULL,
    "invitedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BuyerOrgInvite_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User" ADD COLUMN "activeBuyerOrgId" TEXT;

CREATE UNIQUE INDEX "BuyerOrgMember_buyerOrgId_userId_key" ON "BuyerOrgMember"("buyerOrgId", "userId");
CREATE INDEX "BuyerOrgMember_userId_idx" ON "BuyerOrgMember"("userId");

CREATE UNIQUE INDEX "BuyerOrgInvite_tokenHash_key" ON "BuyerOrgInvite"("tokenHash");
CREATE INDEX "BuyerOrgInvite_buyerOrgId_idx" ON "BuyerOrgInvite"("buyerOrgId");
CREATE INDEX "BuyerOrgInvite_email_idx" ON "BuyerOrgInvite"("email");
-- One pending (un-accepted) invite per email per org.
CREATE UNIQUE INDEX "BuyerOrgInvite_pending_email_org_uniq" ON "BuyerOrgInvite"("buyerOrgId", "email") WHERE "acceptedAt" IS NULL;

ALTER TABLE "BuyerOrgMember" ADD CONSTRAINT "BuyerOrgMember_buyerOrgId_fkey" FOREIGN KEY ("buyerOrgId") REFERENCES "BuyerOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuyerOrgMember" ADD CONSTRAINT "BuyerOrgMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuyerOrgInvite" ADD CONSTRAINT "BuyerOrgInvite_buyerOrgId_fkey" FOREIGN KEY ("buyerOrgId") REFERENCES "BuyerOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_activeBuyerOrgId_fkey" FOREIGN KEY ("activeBuyerOrgId") REFERENCES "BuyerOrg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

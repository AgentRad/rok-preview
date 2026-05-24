-- CreateEnum
CREATE TYPE "SupplierMemberRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateTable
CREATE TABLE "SupplierMember" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "SupplierMemberRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierMember_supplierId_userId_key" ON "SupplierMember"("supplierId", "userId");

-- CreateIndex
CREATE INDEX "SupplierMember_userId_idx" ON "SupplierMember"("userId");

-- AddForeignKey
ALTER TABLE "SupplierMember" ADD CONSTRAINT "SupplierMember_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierMember" ADD CONSTRAINT "SupplierMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "SupplierInvite" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "SupplierMemberRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvite_tokenHash_key" ON "SupplierInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "SupplierInvite_supplierId_idx" ON "SupplierInvite"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierInvite_email_idx" ON "SupplierInvite"("email");

-- AddForeignKey
ALTER TABLE "SupplierInvite" ADD CONSTRAINT "SupplierInvite_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing Supplier with a linked userId becomes an OWNER
-- membership, so the new permission helpers behave identically for legacy
-- single-user suppliers.
INSERT INTO "SupplierMember" ("id", "supplierId", "userId", "role", "createdAt")
SELECT 'sm-' || "id", "id", "userId", 'OWNER', CURRENT_TIMESTAMP
FROM "Supplier"
WHERE "userId" IS NOT NULL;

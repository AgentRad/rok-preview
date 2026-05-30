-- AlterTable: add OEM public storefront fields to User
ALTER TABLE "User"
  ADD COLUMN "manufacturerTagline" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "manufacturerBio" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "manufacturerLogoUrl" TEXT,
  ADD COLUMN "manufacturerWebsite" TEXT NOT NULL DEFAULT '';

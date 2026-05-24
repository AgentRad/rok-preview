-- AlterTable
ALTER TABLE "Supplier"
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "website" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "description" TEXT NOT NULL DEFAULT '';

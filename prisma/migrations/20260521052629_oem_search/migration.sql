-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MANUFACTURER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "manufacturerName" TEXT;

-- CreateTable
CREATE TABLE "SearchEvent" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('OPEN', 'QUOTED', 'ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "quoteOnly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "QuoteRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "buyerId" TEXT,
    "buyerName" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "status" "QuoteStatus" NOT NULL DEFAULT 'OPEN',
    "quotedUnitCents" INTEGER,
    "quoteNote" TEXT NOT NULL DEFAULT '',
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quotedAt" TIMESTAMP(3),

    CONSTRAINT "QuoteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_reference_key" ON "QuoteRequest"("reference");

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

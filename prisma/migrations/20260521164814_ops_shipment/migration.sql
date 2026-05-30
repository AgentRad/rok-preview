-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "shipmentStage" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "trackingCode" TEXT;

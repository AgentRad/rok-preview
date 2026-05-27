-- PLH-3g Phase 5: per-supplier shipment state on OrderSupplierSlot.
--
-- Each slot now carries its own carrier / trackingCode / trackingUrl /
-- shipmentStage / shippedAt / deliveredAt. The parent Order keeps its
-- top-level shipmentStage as the AGGREGATE state (Pending / "Partial: N
-- of M shipped" / Shipped / Delivered) recomputed inside markSlotShipped
-- in src/lib/shipping.ts.
--
-- Backfill: pre-PLH-3g orders were single-supplier; one slot per order
-- mirrors the top-level Order shipment fields exactly. Order.trackingUrl
-- did not exist pre-PLH-3g so the slot's trackingUrl is left NULL on
-- backfill. New orders generated after this migration write the slot
-- fields directly and the aggregate Order.shipmentStage is recomputed.

ALTER TABLE "OrderSupplierSlot"
  ADD COLUMN "carrier" TEXT,
  ADD COLUMN "trackingCode" TEXT,
  ADD COLUMN "trackingUrl" TEXT,
  ADD COLUMN "shipmentStage" TEXT NOT NULL DEFAULT 'Pending',
  ADD COLUMN "shippedAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3);

-- Backfill from the parent Order's pre-PLH-3g single-supplier fields.
-- Order.shipmentStage defaults to '' (empty string) on pre-PLH-3a rows;
-- map that to 'Pending' to match the new slot default.
UPDATE "OrderSupplierSlot" s
SET
  "carrier"       = o."carrier",
  "trackingCode"  = o."trackingCode",
  "shipmentStage" = CASE
    WHEN o."shipmentStage" IS NULL OR o."shipmentStage" = '' THEN 'Pending'
    ELSE o."shipmentStage"
  END,
  "shippedAt"     = o."shippedAt",
  "deliveredAt"   = o."deliveredAt"
FROM "Order" o
WHERE s."orderId" = o."id";

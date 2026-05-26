-- PLH-2 Phase 4e: cron audit findings E1-E5

-- E2: track when sendOrderDelivered fired successfully after auto-deliver.
ALTER TABLE "Order" ADD COLUMN "deliveryEmailSentAt" TIMESTAMP(3);

-- E3: two-stage RELEASE lifecycle so the Stripe transfer fires AFTER the
-- row is staked out but BEFORE reserveBalanceCents is decremented.
ALTER TABLE "SupplierReserveTransaction" ADD COLUMN "status" TEXT;
CREATE INDEX "SupplierReserveTransaction_status_idx" ON "SupplierReserveTransaction"("status");

-- E5: persisted reconcile cursor singleton.
CREATE TABLE "ReconciliationState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "cursor" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReconciliationState_pkey" PRIMARY KEY ("id")
);

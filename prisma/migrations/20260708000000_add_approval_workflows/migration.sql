-- PLH-3y-6: approval workflows (final round of the buyer-org epic).
--
-- Order gains an approvalStatus that composes with the existing status column:
-- an order with approvalStatus=PENDING cannot transition status to PAID. NONE
-- is the default so every existing order and every non-org / no-rule order is
-- completely unaffected. BuyerOrgMember gains out-of-office delegation fields.
-- ApprovalRule + OrderApproval back the engine, queue, and audit trail.

ALTER TABLE "Order" ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Order" ADD COLUMN "approvedByMemberId" TEXT;

ALTER TABLE "BuyerOrgMember" ADD COLUMN "oooUntil" TIMESTAMP(3);
ALTER TABLE "BuyerOrgMember" ADD COLUMN "delegateToMemberId" TEXT;

CREATE TABLE "ApprovalRule" (
  "id" TEXT NOT NULL,
  "buyerOrgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "minTotalCents" INTEGER,
  "maxTotalCents" INTEGER,
  "category" TEXT,
  "supplierId" TEXT,
  "placedByMemberId" TEXT,
  "approverMemberId" TEXT,
  "approverRole" "BuyerOrgRole",
  "chainGroup" TEXT,
  "chainOrder" INTEGER NOT NULL DEFAULT 0,
  "escalateAfterHours" INTEGER,
  "escalateToMemberId" TEXT,
  "autoApproveIfHistoricalMatch" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApprovalRule_buyerOrgId_enabled_idx" ON "ApprovalRule"("buyerOrgId", "enabled");

ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_buyerOrgId_fkey"
  FOREIGN KEY ("buyerOrgId") REFERENCES "BuyerOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OrderApproval" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "ruleId" TEXT,
  "approverMemberId" TEXT,
  "outcome" TEXT NOT NULL DEFAULT 'PENDING',
  "chainOrder" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "OrderApproval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderApproval_orderId_idx" ON "OrderApproval"("orderId");
CREATE INDEX "OrderApproval_approverMemberId_outcome_idx" ON "OrderApproval"("approverMemberId", "outcome");
CREATE INDEX "OrderApproval_outcome_createdAt_idx" ON "OrderApproval"("outcome", "createdAt");

ALTER TABLE "OrderApproval" ADD CONSTRAINT "OrderApproval_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

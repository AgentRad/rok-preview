-- PLH-3y-6 prerequisite: persistent Order.buyerOrgId.
--
-- PLH-3y-2 made org spend-visibility membership-based with no column. Approval
-- workflows require orders permanently tied to an org (a member can leave the
-- org and the order must still belong to it). buyerOrgId is set at order
-- creation when the placing buyer has an activeBuyerOrgId. Historical orders
-- stay NULL (no backfill); the spend-visibility filter prefers the column when
-- present and falls back to current membership for legacy NULL orders.

ALTER TABLE "Order" ADD COLUMN "buyerOrgId" TEXT;

ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerOrgId_fkey"
  FOREIGN KEY ("buyerOrgId") REFERENCES "BuyerOrg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Order_buyerOrgId_idx" ON "Order"("buyerOrgId");

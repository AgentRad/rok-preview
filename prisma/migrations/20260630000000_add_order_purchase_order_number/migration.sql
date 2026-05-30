-- PLH-3v: enterprise procurement requirement. Buyers can attach a
-- company purchase-order number to an order at checkout for invoice
-- reference. Nullable, 64-char cap enforced in the API layer; indexed
-- for substring search in the buyer order history.

ALTER TABLE "Order" ADD COLUMN "purchaseOrderNumber" TEXT;

CREATE INDEX "Order_purchaseOrderNumber_idx"
  ON "Order" ("purchaseOrderNumber");

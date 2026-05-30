-- PLH-3i P3: stamp the QBO RefundReceipt id on the Refund row so the
-- refund-sync primitive is idempotent (skip-if-set) and admins can trace
-- a PartsPort Refund back to its QBO document.
ALTER TABLE "Refund" ADD COLUMN "qboRefundReceiptId" text NULL;

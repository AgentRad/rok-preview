-- PLH-3g Phase 1: per-supplier slot inside an Order.
--
-- Backfill assumes one-supplier-per-order (the pre-PLH-3g constraint
-- enforced client-side in src/lib/cart.ts and server-side in
-- /api/orders/route.ts POST). New multi-supplier orders generate one slot
-- per supplier at creation time once the rest of the PLH-3g phases land.

CREATE TABLE "OrderSupplierSlot" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "freightCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderSupplierSlot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderSupplierSlot_orderId_supplierId_key"
    ON "OrderSupplierSlot"("orderId", "supplierId");

CREATE INDEX "OrderSupplierSlot_supplierId_idx"
    ON "OrderSupplierSlot"("supplierId");

CREATE INDEX "OrderSupplierSlot_payoutId_idx"
    ON "OrderSupplierSlot"("payoutId");

ALTER TABLE "OrderSupplierSlot"
    ADD CONSTRAINT "OrderSupplierSlot_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderSupplierSlot"
    ADD CONSTRAINT "OrderSupplierSlot_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderSupplierSlot"
    ADD CONSTRAINT "OrderSupplierSlot_payoutId_fkey"
    FOREIGN KEY ("payoutId") REFERENCES "Payout"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one slot per existing Order. Supplier derived from the
-- order's items' product.supplierId. Today every Order is single-supplier
-- so SELECT DISTINCT yields exactly one supplier per order. Subtotal is
-- re-summed from OrderItem rows (qty * unitPriceCents) for accuracy.
-- freightCents, feeCents, refundedCents copy directly from Order. payoutId
-- looks up any pre-existing Payout row keyed on (orderId, supplierId).
INSERT INTO "OrderSupplierSlot" (
    "id",
    "orderId",
    "supplierId",
    "subtotalCents",
    "freightCents",
    "feeCents",
    "refundedCents",
    "payoutId",
    "createdAt",
    "updatedAt"
)
SELECT
    'oss_' || o."id" || '_' || s."supplierId"               AS "id",
    o."id"                                                  AS "orderId",
    s."supplierId"                                          AS "supplierId",
    s."subtotalCents"                                       AS "subtotalCents",
    o."freightCents"                                        AS "freightCents",
    o."feeCents"                                            AS "feeCents",
    o."refundedCents"                                       AS "refundedCents",
    (
        SELECT p."id" FROM "Payout" p
         WHERE p."orderId" = o."id" AND p."supplierId" = s."supplierId"
         LIMIT 1
    )                                                       AS "payoutId",
    o."createdAt"                                           AS "createdAt",
    CURRENT_TIMESTAMP                                       AS "updatedAt"
FROM "Order" o
JOIN (
    SELECT
        oi."orderId"                                        AS "orderId",
        p."supplierId"                                      AS "supplierId",
        SUM(oi."qty" * oi."unitPriceCents")::INTEGER        AS "subtotalCents"
    FROM "OrderItem" oi
    JOIN "Product" p ON p."id" = oi."productId"
    GROUP BY oi."orderId", p."supplierId"
) s ON s."orderId" = o."id"
ON CONFLICT ("orderId", "supplierId") DO NOTHING;

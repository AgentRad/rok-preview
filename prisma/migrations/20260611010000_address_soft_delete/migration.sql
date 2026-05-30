-- PLH-3j P2: soft-delete Address so historical orders that embedded an
-- Address relation do not lose their ship-to denorm when the buyer
-- deletes the row from their address book. Mirrors the Supplier
-- soft-delete pattern.
--
-- Read paths filter deletedAt IS NULL; DELETE flips deletedAt instead
-- of actually removing the row.

ALTER TABLE "Address" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Address_userId_deletedAt_idx" ON "Address" ("userId", "deletedAt");

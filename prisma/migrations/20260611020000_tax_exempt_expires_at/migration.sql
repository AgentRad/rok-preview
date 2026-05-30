-- PLH-3j P4: tax-exempt certificate expiry date. Resale and government-
-- entity certificates typically expire after 1 to 3 years depending on
-- the state. Tracking expiry lets us:
--   1. Email the buyer 30 days before to refresh the cert.
--   2. Re-prompt at checkout if the cert is already expired (so we do
--      not skip tax computation on a stale cert).
--
-- Column is nullable: certs uploaded before P4 don't have an expiry
-- date on file yet. Buyers can edit each address to add one. The cron
-- ignores rows where the field is null.

ALTER TABLE "Address" ADD COLUMN "taxExemptExpiresAt" TIMESTAMP(3);

CREATE INDEX "Address_taxExemptExpiresAt_idx" ON "Address" ("taxExemptExpiresAt");

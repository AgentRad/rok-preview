-- Per-address tax exemption fields. When a buyer uploads a resale or
-- government-entity certificate and admin approves it, Stripe Tax (or any
-- other engine) skips tax computation on orders shipping to that address.
ALTER TABLE "Address" ADD COLUMN "taxExemptCertificateUrl" TEXT;
ALTER TABLE "Address" ADD COLUMN "taxExemptStatus" TEXT;

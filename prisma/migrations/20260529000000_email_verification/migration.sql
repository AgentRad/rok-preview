-- Email verification + account soft-delete columns on User.
--
-- emailVerified: when the user clicked the link in the verification email.
-- emailVerificationToken: opaque random hex; cleared after use.
-- emailVerificationExpiresAt: token TTL (24 hours by default).
-- emailVerificationSentAt: used by the resend endpoint to rate-limit per-user.
--
-- deletedAt: soft-delete sentinel. When set, the row's PII is anonymized
-- (email rewritten to deleted-<id>@anon.partsport.local, name cleared) but
-- the row remains so historical orders/invoices keep a non-null buyerId for
-- legal/tax retention. Hard-delete is opt-in after a 30-day grace window.
ALTER TABLE "User" ADD COLUMN "emailVerified" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "emailVerificationToken" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerificationExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "emailVerificationSentAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_emailVerificationToken_key"
  ON "User"("emailVerificationToken");

-- Grandfather existing demo users + already-onboarded accounts so they
-- don't get locked out of orders/listings on first deploy. New signups
-- after this migration go through the verify flow.
UPDATE "User" SET "emailVerified" = CURRENT_TIMESTAMP WHERE "emailVerified" IS NULL;

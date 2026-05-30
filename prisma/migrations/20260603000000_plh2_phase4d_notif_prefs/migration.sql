-- PLH-2 Phase 4d (D1): non-transactional email opt-out flags. Transactional
-- emails (auth, money movement, order/return state changes) always send;
-- these three booleans only gate marketing-ish mail (product update
-- broadcasts, marketing announcements, etc.) for CAN-SPAM compliance.
ALTER TABLE "User" ADD COLUMN "notifyOrderEmails" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "notifyMarketingEmails" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "notifyProductUpdates" BOOLEAN NOT NULL DEFAULT true;

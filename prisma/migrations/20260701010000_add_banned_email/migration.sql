-- PLH-3w P1: email blacklist for banned accounts.
--
-- A BANNED user's email is recorded here so the register route can refuse
-- re-signup with a generic "registration unavailable" message. email is
-- unique and stored lowercased to match normalizeEmail() in the register
-- flow.

CREATE TABLE "BannedEmail" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "bannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bannedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "BannedEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BannedEmail_email_key" ON "BannedEmail"("email");
CREATE INDEX "BannedEmail_bannedByUserId_idx" ON "BannedEmail"("bannedByUserId");

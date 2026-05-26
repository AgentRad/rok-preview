-- PLH-1 commit 2: timestamp at which a deleted user's PII was scrubbed.
-- Set by /api/cron/anonymize-deleted-accounts 30 days after deletedAt.
ALTER TABLE "User" ADD COLUMN "anonymizedAt" TIMESTAMP(3);

-- PLH-3w P2: per-role 2FA enforcement support columns on User.
--
-- backupCodesHashed is the canonical single-use backup-code store (sha256
-- hashes, 8 generated at enable/regenerate). Defaults to an empty array so
-- existing rows are valid; the legacy totpBackupCodes Json column is kept
-- as a read fallback for accounts enrolled before this round.
--
-- twoFactorRecoveryUntil holds the admin "2FA recovery in progress"
-- override timestamp; when in the future, the enforcement interstitial is
-- suppressed for that user (1-hour window set by the admin route).

ALTER TABLE "User" ADD COLUMN "backupCodesHashed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "twoFactorRecoveryUntil" TIMESTAMP(3);

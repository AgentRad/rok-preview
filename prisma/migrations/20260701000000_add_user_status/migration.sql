-- PLH-3w P1: account trust status on User.
--
-- UserStatus is a new enum (ACTIVE | SUSPENDED | BANNED). The column
-- defaults to ACTIVE so every existing row is unaffected. The three
-- suspension-context columns are nullable and only written when an admin
-- suspends or bans the account.

CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');

ALTER TABLE "User" ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "User" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "suspendedReason" TEXT;
ALTER TABLE "User" ADD COLUMN "suspendedByUserId" TEXT;

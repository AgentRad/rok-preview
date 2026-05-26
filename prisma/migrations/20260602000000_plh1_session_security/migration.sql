-- PLH-1: auth session security hardening.

-- Server-side session invalidation. Every JWT carries an `svf` claim
-- (epoch ms); getCurrentUser rejects the cookie when this column moves
-- forward past the issuedAt. Default NOW() so existing sessions stay
-- valid until the user's next sensitive action bumps it.
ALTER TABLE "User"
  ADD COLUMN "sessionsValidFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Hash the email verification token at rest. We add the new column, copy
-- existing raw tokens through SHA-256 (hex, lowercase) using pgcrypto's
-- digest(), then drop the raw column. The unique index moves to the hash.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "User" ADD COLUMN "emailVerificationTokenHash" TEXT;

UPDATE "User"
  SET "emailVerificationTokenHash" = encode(digest("emailVerificationToken", 'sha256'), 'hex')
  WHERE "emailVerificationToken" IS NOT NULL;

DROP INDEX IF EXISTS "User_emailVerificationToken_key";
ALTER TABLE "User" DROP COLUMN "emailVerificationToken";

CREATE UNIQUE INDEX "User_emailVerificationTokenHash_key"
  ON "User"("emailVerificationTokenHash");

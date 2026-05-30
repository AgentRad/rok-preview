-- PLH-3c F3: OEM approval gate. New ManufacturerApplication model + enum.
-- Backfill: every existing MANUFACTURER user with a non-null
-- manufacturerName is auto-APPROVED so live storefronts don't drop
-- between deploy + first admin login.

CREATE TYPE "MfgAppStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "ManufacturerApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "manufacturerName" TEXT NOT NULL,
    "status" "MfgAppStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "rejectionReason" TEXT,

    CONSTRAINT "ManufacturerApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManufacturerApplication_userId_key"
  ON "ManufacturerApplication"("userId");
CREATE INDEX "ManufacturerApplication_status_idx"
  ON "ManufacturerApplication"("status");

ALTER TABLE "ManufacturerApplication"
  ADD CONSTRAINT "ManufacturerApplication_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ManufacturerApplication"
  ADD CONSTRAINT "ManufacturerApplication_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: auto-approve every existing claimed-brand MANUFACTURER so
-- live storefronts continue to render after this migration lands.
INSERT INTO "ManufacturerApplication"
  ("id", "userId", "manufacturerName", "status", "submittedAt", "reviewedAt")
SELECT
  gen_random_uuid()::text,
  "id",
  "manufacturerName",
  'APPROVED',
  now(),
  now()
FROM "User"
WHERE "role" = 'MANUFACTURER' AND "manufacturerName" IS NOT NULL;

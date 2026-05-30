-- Expand SupplierMemberRole from (OWNER, MEMBER) to the full role matrix.
-- Existing MEMBER rows become ADMIN (closest equivalent: full operational
-- access without team management).

ALTER TYPE "SupplierMemberRole" RENAME TO "SupplierMemberRole_old";

CREATE TYPE "SupplierMemberRole" AS ENUM (
  'OWNER',
  'ADMIN',
  'SALES',
  'FULFILLMENT',
  'CATALOG',
  'FINANCE',
  'VIEWER'
);

-- SupplierMember
ALTER TABLE "SupplierMember"
  ALTER COLUMN "role" DROP DEFAULT,
  ALTER COLUMN "role" TYPE "SupplierMemberRole" USING (
    CASE "role"::text
      WHEN 'MEMBER' THEN 'ADMIN'::"SupplierMemberRole"
      WHEN 'OWNER' THEN 'OWNER'::"SupplierMemberRole"
      ELSE 'ADMIN'::"SupplierMemberRole"
    END
  ),
  ALTER COLUMN "role" SET DEFAULT 'ADMIN';

-- SupplierInvite
ALTER TABLE "SupplierInvite"
  ALTER COLUMN "role" DROP DEFAULT,
  ALTER COLUMN "role" TYPE "SupplierMemberRole" USING (
    CASE "role"::text
      WHEN 'MEMBER' THEN 'ADMIN'::"SupplierMemberRole"
      WHEN 'OWNER' THEN 'OWNER'::"SupplierMemberRole"
      ELSE 'ADMIN'::"SupplierMemberRole"
    END
  ),
  ALTER COLUMN "role" SET DEFAULT 'ADMIN';

DROP TYPE "SupplierMemberRole_old";

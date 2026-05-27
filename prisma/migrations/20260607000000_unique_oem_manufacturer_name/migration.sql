-- PLH-3c F2: partial unique index on User.manufacturerName so two
-- MANUFACTURER accounts cannot race to claim the same brand. Prisma
-- does not model partial unique indexes natively; we hand-author the
-- migration and document the invariant in the schema comment.
CREATE UNIQUE INDEX "User_manufacturerName_role_key"
  ON "User" ("manufacturerName")
  WHERE "role" = 'MANUFACTURER' AND "manufacturerName" IS NOT NULL;

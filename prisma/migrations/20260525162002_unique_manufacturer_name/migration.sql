-- Partial-unique index on User.manufacturerName so two MANUFACTURER users
-- can't sit on the same brand. NULL is allowed for non-OEM users; the
-- partial WHERE clause excludes nulls from the uniqueness constraint.
CREATE UNIQUE INDEX "User_manufacturerName_unique"
  ON "User" ("manufacturerName")
  WHERE "manufacturerName" IS NOT NULL;

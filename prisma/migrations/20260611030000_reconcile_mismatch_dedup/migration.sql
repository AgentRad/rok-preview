-- PLH-3j P7: dedupe reconcile mismatch AuditLog rows so capped runs
-- that replay the same 7-day window do not write the same mismatch
-- multiple times.
--
-- Postgres partial unique index on the JSON-extracted kind + windowStart
-- keys. Scoped to RECONCILIATION_MISMATCH only so other audit actions
-- are not constrained.
--
-- Prisma 6 does not model partial indexes with expression keys
-- natively, so this is a hand-authored SQL-only migration. The write
-- path in src/app/api/admin/cron/reconcile/route.ts catches a 23505
-- (unique_violation) inside the writeAuditLog wrapper and treats it as
-- "already recorded, skip silently" via a raw INSERT ... ON CONFLICT
-- DO NOTHING path (added in the same commit).

CREATE UNIQUE INDEX "AuditLog_reconcile_mismatch_dedup_uniq"
ON "AuditLog" (
  "action",
  "targetId",
  ((metadata ->> 'kind')),
  ((metadata ->> 'windowStart'))
)
WHERE "action" = 'RECONCILIATION_MISMATCH';

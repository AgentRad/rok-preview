-- AuditLog: append-only record of admin mutations + sensitive operations.
-- Every row pins: who did it (actorId + email snapshot), what they did
-- (action), what got touched (targetType + targetId), a human-readable
-- summary for the admin UI, plus a JSON metadata bag for the bits that
-- don't fit. Created lazily; older history is whatever the orchestrator
-- can reconstruct from git + the deploy logs.

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "actorEmail" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

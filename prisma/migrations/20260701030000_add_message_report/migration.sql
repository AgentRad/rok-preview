-- PLH-3w P3: abuse reporting on messages.
--
-- A user flags a Message via /api/messages/[id]/report; an admin reviews it
-- at /admin/reported-messages and either dismisses (clears reportedAt) or
-- suspends the sender. All columns nullable; the index drives the queue.

ALTER TABLE "Message" ADD COLUMN "reportedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "reportedByUserId" TEXT;
ALTER TABLE "Message" ADD COLUMN "reportReason" TEXT;
ALTER TABLE "Message" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "reviewedByUserId" TEXT;

CREATE INDEX "Message_reportedAt_idx" ON "Message"("reportedAt");

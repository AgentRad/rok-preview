-- PLH-3q P1: cross-role direct message threads.
--
-- DirectMessageThread holds the subject + creator + denormalized
-- lastMessageAt (for inbox sort). DirectMessageParticipant rows are one
-- per (thread, user); joinedAt is used as a filter floor so added
-- participants only see messages posted after they joined (email
-- semantics, not Slack semantics).
--
-- Message gets an optional directThreadId. Exactly one of (orderId,
-- quoteId, directThreadId) is set per Message row; the constraint is
-- enforced at the API boundary because Prisma cannot model the OR.

CREATE TABLE "DirectMessageThread" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectMessageThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DirectMessageParticipant" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedByUserId" TEXT NOT NULL,

    CONSTRAINT "DirectMessageParticipant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DirectMessageParticipant_threadId_userId_key"
    ON "DirectMessageParticipant"("threadId", "userId");

CREATE INDEX "DirectMessageParticipant_userId_joinedAt_idx"
    ON "DirectMessageParticipant"("userId", "joinedAt");

ALTER TABLE "DirectMessageThread"
    ADD CONSTRAINT "DirectMessageThread_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DirectMessageParticipant"
    ADD CONSTRAINT "DirectMessageParticipant_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "DirectMessageThread"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DirectMessageParticipant"
    ADD CONSTRAINT "DirectMessageParticipant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Message" ADD COLUMN "directThreadId" TEXT;

CREATE INDEX "Message_directThreadId_idx" ON "Message"("directThreadId");

ALTER TABLE "Message"
    ADD CONSTRAINT "Message_directThreadId_fkey"
    FOREIGN KEY ("directThreadId") REFERENCES "DirectMessageThread"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

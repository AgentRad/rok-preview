-- PLH-3p F4: per-user thread-read pointer for unread message badges.
--
-- One row per (userId, threadKind, threadId). Absence of a row means the
-- user has never opened the thread, so every message on it counts as
-- unread. Inserted/updated via PATCH /api/messages/mark-read whenever a
-- thread page mounts for an authenticated user.

CREATE TABLE "ThreadLastRead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadKind" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThreadLastRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ThreadLastRead_userId_threadKind_threadId_key"
    ON "ThreadLastRead"("userId", "threadKind", "threadId");

CREATE INDEX "ThreadLastRead_userId_idx" ON "ThreadLastRead"("userId");

ALTER TABLE "ThreadLastRead"
    ADD CONSTRAINT "ThreadLastRead_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

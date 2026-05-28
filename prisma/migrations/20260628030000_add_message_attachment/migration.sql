-- PLH-3p F2: file attachments on thread messages.
--
-- One row per file attached to a Message. Files live in Vercel Blob under
-- messages/{messageId}/{random}-{filename}; the row stores the public URL
-- alongside size + mime so the UI can render a chip without re-fetching
-- the blob. Upload route caps at 5 MB per file, 5 files per message, and
-- restricts to PNG/JPEG/PDF/DOCX via magic-byte detection.

CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "blobUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");

ALTER TABLE "MessageAttachment"
    ADD CONSTRAINT "MessageAttachment_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "Message"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

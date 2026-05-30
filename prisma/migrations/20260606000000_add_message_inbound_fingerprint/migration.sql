-- PLH-3b F2: inbound dedup via Message.inboundFingerprint.
--
-- Inbound email webhooks can fire twice for the same message (provider
-- retry on a 5xx, user double-send, etc). Compute a sha256 fingerprint of
-- (senderId, orderId, quoteId, body) at inbound time and rely on the unique
-- index to short-circuit duplicates with a Prisma P2002. UI-posted messages
-- keep inboundFingerprint NULL, which the unique index allows freely.

ALTER TABLE "Message" ADD COLUMN "inboundFingerprint" TEXT;

CREATE UNIQUE INDEX "Message_inboundFingerprint_key"
  ON "Message"("inboundFingerprint");

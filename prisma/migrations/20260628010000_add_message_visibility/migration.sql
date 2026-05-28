-- PLH-3p F3: Message.visibility enum for internal supplier and admin-only notes.
--
-- PUBLIC (default): visible to all parties on the thread, fans out to all
--   recipients (existing behavior).
-- SUPPLIER_INTERNAL: only the posting supplier's team (and admins) can see;
--   buyer never sees it and is not emailed.
-- BUYER_INTERNAL: only the buyer (and admins) can see; suppliers never see
--   it and are not emailed.
-- ADMIN_ONLY: only admins can see; no outbound email.

CREATE TYPE "MessageVisibility" AS ENUM (
  'PUBLIC',
  'SUPPLIER_INTERNAL',
  'BUYER_INTERNAL',
  'ADMIN_ONLY'
);

ALTER TABLE "Message"
  ADD COLUMN "visibility" "MessageVisibility" NOT NULL DEFAULT 'PUBLIC';

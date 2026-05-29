-- QA2 auth/SSO BUG 3: TOTP anti-replay. Persist the last consumed 30-second
-- step (counter) on a successful 2FA login so a code cannot be replayed within
-- the window:1 (~90s) validation tolerance. Null until the first 2FA login.
ALTER TABLE "User" ADD COLUMN "lastTotpStep" INTEGER;

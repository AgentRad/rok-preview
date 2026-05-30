import crypto from "node:crypto";

/**
 * QA2 web LOW fix: time-bounded, fallback-free unsubscribe token.
 *
 * Pure logic, extracted out of email.ts (which carries the `server-only`
 * guard) so scripts/test-unsubscribe-token.mjs can import and unit-test it
 * directly, mirroring the strip-quoted-reply.ts extraction pattern.
 *
 * Token shape: `${userId}.${issuedAtMs}.${sig}` where
 *   sig = HMAC-SHA256(secret, `${userId}.${issuedAtMs}`) hex, first 24 chars.
 *
 * The issued-at is part of the signed payload, so it cannot be tampered with
 * to extend the lifetime. verify checks signature first, then expiry on the
 * now-authenticated issued-at.
 *
 * No hardcoded fallback secret: when no real secret is configured, sign
 * returns null (caller omits the one-click List-Unsubscribe URL and falls
 * back to the mailto unsubscribe) and verify returns null.
 */

// 90 days. The link rides in marketing emails that may be opened weeks late,
// so the window is generous; a normal user clicking unsubscribe from a recent
// email is never rejected. Old (pre-fix) tokens had no expiry; they fail the
// 3-part parse and simply require the user to use a freshly-issued link.
export const UNSUBSCRIBE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// Tolerate small clock skew between signer and verifier (issued slightly in
// the future is fine up to a day; beyond that the token is treated as bogus).
const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

export function unsubscribeTokenExpired(
  issuedAtMs: number,
  nowMs: number,
  maxAgeMs: number = UNSUBSCRIBE_MAX_AGE_MS
): boolean {
  if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0) return true;
  if (issuedAtMs > nowMs + FUTURE_SKEW_MS) return true;
  return nowMs - issuedAtMs > maxAgeMs;
}

function unsubSig(secret: string, userId: string, issued: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${userId}.${issued}`)
    .digest("hex")
    .slice(0, 24);
}

export function signUnsubscribeTokenWith(
  secret: string | null,
  userId: string,
  issuedAtMs: number
): string | null {
  if (!secret) return null;
  const issued = String(issuedAtMs);
  return `${userId}.${issued}.${unsubSig(secret, userId, issued)}`;
}

export function verifyUnsubscribeTokenWith(
  secret: string | null,
  token: string,
  nowMs: number,
  maxAgeMs: number = UNSUBSCRIBE_MAX_AGE_MS
): string | null {
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, issued, sig] = parts;
  if (!userId || !issued || !sig) return null;
  if (!/^\d+$/.test(issued)) return null;
  const expected = unsubSig(secret, userId, issued);
  if (expected.length !== sig.length) return null;
  try {
    if (
      !crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8"))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  // Signature verified, so `issued` is authenticated; safe to check expiry.
  if (unsubscribeTokenExpired(Number(issued), nowMs, maxAgeMs)) return null;
  return userId;
}

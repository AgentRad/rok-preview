import "server-only";

/**
 * PLH-1 commit 2: shared user-name + email validation. Centralized so
 * /api/auth/register and /api/account/profile apply the exact same
 * normalization (trim, NFKC, strip zero-width, cap 80 chars). Returns a
 * cleaned name or null when the input is unusable.
 */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // NFKC folds compatibility forms (full-width Latin, ligatures, etc.) so
  // homoglyph attacks have a harder time. Then strip zero-width chars
  // which are sometimes used to hide content inside a name.
  let s = raw.normalize("NFKC");
  s = s.replace(/[​-‍﻿]/g, "");
  s = s.trim();
  if (s.length === 0) return null;
  if (s.length > 80) s = s.slice(0, 80);
  return s;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Trim + lowercase, then validate with the same regex used elsewhere.
 * Returns null when invalid.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s || !EMAIL_RE.test(s)) return null;
  return s;
}

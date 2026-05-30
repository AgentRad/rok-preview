import "server-only";

/**
 * Vercel Cron Jobs hit our endpoint with an `Authorization: Bearer <secret>`
 * header. We compare against CRON_SECRET in env. Returns true on a valid
 * request, false on anything else (the route then returns 401).
 *
 * Behavior matrix (after the P9 audit found "fail open everywhere"):
 *   - Production (NODE_ENV=production OR VERCEL_ENV=production):
 *     CRON_SECRET MUST be set AND the header must match. A missing secret
 *     fails closed (401) so we can't accidentally ship to prod with
 *     unauthenticated crons. A startup warning is logged on the first
 *     call so the deploy logs show why crons are refusing.
 *   - Preview / dev (no production marker): when CRON_SECRET is unset
 *     the gate falls open so an admin can manually trigger crons from
 *     the browser or curl without env setup.
 */

let warnedMissingProdSecret = false;

function isProduction(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  );
}

export function isAuthorizedCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (isProduction()) {
      if (!warnedMissingProdSecret) {
        // eslint-disable-next-line no-console
        console.warn(
          "[cron-auth] CRON_SECRET is unset in production. All cron + admin-cron requests will be refused with 401. Generate with `openssl rand -hex 32` and add to Vercel env."
        );
        warnedMissingProdSecret = true;
      }
      return false;
    }
    return true;
  }
  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  return header.slice(7).trim() === secret;
}

export function isCronSecretConfigured(): boolean {
  return !!process.env.CRON_SECRET;
}

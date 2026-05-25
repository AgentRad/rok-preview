import "server-only";

/**
 * Vercel Cron Jobs hit our endpoint with an `Authorization: Bearer <secret>`
 * header. We compare against CRON_SECRET in env. Returns true on a valid
 * request, false on anything else (the route then returns 401).
 *
 * In dev / preview without CRON_SECRET set the gate falls open so admins
 * can hit the route manually for testing. Production deploys MUST set
 * CRON_SECRET in Vercel.
 */
export function isAuthorizedCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  return header.slice(7).trim() === secret;
}

export function isCronSecretConfigured(): boolean {
  return !!process.env.CRON_SECRET;
}

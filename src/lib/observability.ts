import "server-only";
import * as Sentry from "@sentry/nextjs";

/**
 * Single capture helper used by API route catch blocks. Logs to console
 * (so the Vercel function logs still show the trace) and forwards to
 * Sentry when configured. Centralizing the call here means we can change
 * the backend (or add Datadog, etc.) in one place.
 *
 * `context` is an optional bag of safe-to-log metadata (route, userId,
 * action) that helps you find the right needle in the Sentry haystack.
 */
export function captureError(
  err: unknown,
  context?: Record<string, unknown>
): void {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error("[error]", message, context ?? {});
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch {
    // Sentry init can fail when env vars are missing in dev; swallow so
    // captureError itself can never throw.
  }
}

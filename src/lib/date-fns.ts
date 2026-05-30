/**
 * Local-date helpers for filename / display use. Server functions don't
 * know the user's timezone unless we pass it through; this helper accepts
 * a tz override (via a `?tz=` query param) and falls back to
 * `America/New_York` since that's where most PartsPort buyers are. Returns
 * a YYYY-MM-DD string suitable for filenames.
 */
export function localDateStamp(req: Request): string {
  const url = new URL(req.url);
  const tz = url.searchParams.get("tz") || "America/New_York";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return parts; // en-CA outputs YYYY-MM-DD
  } catch {
    // Fall back to UTC if the tz string is bogus.
    return new Date().toISOString().slice(0, 10);
  }
}

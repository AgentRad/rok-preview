import "server-only";

/**
 * Is Vercel Blob wired into the deployment? When false, all upload routes
 * return 503 and the editor UIs should preemptively show a hint so the user
 * doesn't pick a file just to get an error.
 */
export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

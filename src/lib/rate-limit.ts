import "server-only";

/**
 * Minimal sliding-window rate limiter for hot endpoints (auth, search,
 * register). In-memory, process-local. Good enough for the early-launch
 * traffic on a single Vercel function instance. For multi-region or
 * higher scale, swap the store for Vercel KV / Upstash Redis - the
 * interface stays the same: `check(key)` returns `{ allowed, retryAfterMs }`.
 *
 * Each named bucket has its own window and capacity. Buckets are keyed by
 * a caller-provided string (typically the client IP).
 *
 * Buckets:
 *   - login:    10 / 15 min  (per IP, against brute-force)
 *   - register: 5  / 1 hr    (per IP, against signup spam)
 *   - search:   30 / 1 min   (per IP, against AI-cost burn)
 *   - generic:  60 / 1 min   (catch-all default)
 */

type Bucket = {
  capacity: number;
  windowMs: number;
};

const BUCKETS: Record<string, Bucket> = {
  login: { capacity: 10, windowMs: 15 * 60_000 },
  register: { capacity: 5, windowMs: 60 * 60_000 },
  search: { capacity: 30, windowMs: 60_000 },
  generic: { capacity: 60, windowMs: 60_000 },
};

// Outer key = bucket name, inner key = caller key (IP). Values are arrays
// of timestamps inside the window. Pruned on access.
const hits = new Map<string, Map<string, number[]>>();

function pruneAndCount(arr: number[], windowMs: number, now: number): number {
  const cutoff = now - windowMs;
  // Drop expired timestamps. Loop instead of filter to mutate in place and
  // keep allocations low on the hot path.
  let write = 0;
  for (let read = 0; read < arr.length; read++) {
    if (arr[read] >= cutoff) {
      arr[write++] = arr[read];
    }
  }
  arr.length = write;
  return arr.length;
}

export type RateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
  /** Remaining slots in the current window (0 once blocked). */
  remaining: number;
};

/**
 * Try to consume one slot in the named bucket for the given key. Returns
 * `{ allowed: true }` and records the hit; or `{ allowed: false }` with a
 * suggested retry delay.
 */
export function rateLimit(
  bucketName: keyof typeof BUCKETS | string,
  key: string
): RateLimitResult {
  const bucket = BUCKETS[bucketName] ?? BUCKETS.generic;
  const now = Date.now();
  let inner = hits.get(bucketName);
  if (!inner) {
    inner = new Map();
    hits.set(bucketName, inner);
  }
  let arr = inner.get(key);
  if (!arr) {
    arr = [];
    inner.set(key, arr);
  }
  const count = pruneAndCount(arr, bucket.windowMs, now);
  if (count >= bucket.capacity) {
    // Suggest retry once the oldest hit ages out of the window.
    const oldest = arr[0] ?? now;
    const retryAfterMs = Math.max(1000, oldest + bucket.windowMs - now);
    return { allowed: false, retryAfterMs, remaining: 0 };
  }
  arr.push(now);
  // Light periodic GC: every ~10k inserts, drop empty caller entries.
  if (arr.length === 1 && inner.size > 5000) {
    for (const [k, v] of inner) {
      if (v.length === 0) inner.delete(k);
    }
  }
  return {
    allowed: true,
    retryAfterMs: 0,
    remaining: bucket.capacity - count - 1,
  };
}

/**
 * Best-effort caller IP. Vercel sets x-forwarded-for; the leftmost entry is
 * the original client. Falls back to a "unknown" bucket so a missing header
 * still rate-limits (against bots that swallow headers).
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

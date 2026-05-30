import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Sliding-window rate limiter. Hybrid backend:
 *   - Upstash Redis (production): durable across function instances,
 *     correct under regional fan-out. Gated on UPSTASH_REDIS_REST_URL +
 *     UPSTASH_REDIS_REST_TOKEN being set.
 *   - In-memory fallback: per-function-instance Map. Good enough for
 *     a single warm Vercel instance, lossy on cold starts and incorrect
 *     under load. Used when the env vars are absent.
 *
 * Callers pass a bucket name + a caller key (typically the client IP,
 * or a composed key like "email:foo@bar.com"). The return type is
 * deliberately the same as the previous in-memory-only implementation so
 * no caller has to change.
 *
 * Bucket tuning is done in the BUCKETS map below. New buckets just need
 * a name + window + capacity; the multi-instance backend doesn't care
 * how many buckets there are.
 */

export type RateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
  /** Remaining slots in the current window (0 once blocked). */
  remaining: number;
};

type Bucket = {
  capacity: number;
  windowMs: number;
};

const BUCKETS: Record<string, Bucket> = {
  // Tighter than the in-memory defaults now that the limiter is
  // distributed; under load these are the right values.
  login: { capacity: 5, windowMs: 60_000 },
  "login:email": { capacity: 20, windowMs: 60 * 60_000 },
  register: { capacity: 3, windowMs: 60 * 60_000 },
  "register:burst": { capacity: 1, windowMs: 60_000 },
  forgot: { capacity: 3, windowMs: 60 * 60_000 },
  search: { capacity: 30, windowMs: 60_000 },
  order: { capacity: 10, windowMs: 60 * 60_000 },
  // Freight estimate hits Shippo per call; 1-per-10s is plenty for a
  // buyer typing a ZIP, blocks bot harvest of quotes.
  "freight-estimate": { capacity: 1, windowMs: 10_000 },
  // P9.5 HIGH 19: dedicated bucket for the checkout /api/freight/quote
  // path. The verify chat caught the previous shared bucket producing
  // 429s when a buyer hit the catalog widget + then refreshed checkout
  // rates within 10 seconds. Higher capacity here because checkout
  // re-quotes are a normal user flow (changing ship-to + surcharges
  // both trigger a refresh).
  "freight-quote": { capacity: 5, windowMs: 60_000 },
  // PLH-1 commit 4: per-supplier cap on Stripe Connect onboarding link
  // creation. Each call hits Stripe's accountLinks.create API, which is
  // rate-limited on their side and costs us latency. 5/hour/supplier is
  // plenty for a real user (they refresh maybe once or twice mid-flow);
  // a runaway client retrying every second hits this before it hits the
  // Stripe limit and gets a clean 429.
  "stripe-connect": { capacity: 5, windowMs: 60 * 60_000 },
  // PLH-2 Phase 2: supplier-facing AI assistant. Each question hits the
  // Anthropic API at real-money cost, so we cap per-supplier traffic at
  // 30/hour. A normal supplier asking 5 to 10 things in a session never
  // touches this; a runaway client loop gets clean 429s.
  "ai-assistant": { capacity: 30, windowMs: 60 * 60_000 },
  // PLH-3f S2: conversational import assistant. Per-supplier cap on
  // the chat action of /api/supplier/catalog-import. Each chat hits
  // the Anthropic API at real-money cost; 30/hour/supplier matches
  // the ai-assistant bucket and stays comfortably above human pace.
  "import-ai": { capacity: 30, windowMs: 60 * 60_000 },
  // PLH-3f: parse + commit actions on the import route. The existing
  // /api/supplier/catalog-import POST shared the "generic" bucket; the
  // new route now pulls under its own name so abuse cannot starve
  // other supplier APIs.
  "catalog-import": { capacity: 30, windowMs: 60 * 60_000 },
  // PLH-2 Phase 4a (A3): catalog cleanup hits Anthropic with a sometimes
  // very large prompt (whole pasted catalog). Hard cap at 10/hour/supplier
  // so a stuck client cannot run up a meaningful bill before the supplier
  // notices.
  "catalog-cleanup": { capacity: 10, windowMs: 60 * 60_000 },
  // PLH-2 Phase 4b (B1): anonymous catalog AI search. Each `/catalog?q=`
  // request runs an Anthropic Opus call server-side with no auth gate, so
  // an unauthenticated burst is direct cost runaway. 20/hour/IP is plenty
  // for a real buyer iterating on queries; abusive clients fall back to
  // the heuristic path and the page still renders.
  "ai-search": { capacity: 20, windowMs: 60 * 60_000 },
  // PLH-3b F7: POST /api/messages per-user cap so a stuck client (or a
  // mis-wired retry loop) cannot fan out the thread fan-out email loop
  // dozens of times a minute. 20/min/user is well above any human pace.
  messages: { capacity: 20, windowMs: 60_000 },
  // PLH-3i P1: outbound Intuit QuickBooks Online API. Intuit's published
  // limit is 500 requests/minute/realm. We register the bucket now so the
  // sync helpers in P2+ can call `rateLimit("intuit", realmId)` without a
  // schema change later. In-memory pass at this round is fine; PartsPort
  // won't approach this limit at launch.
  intuit: { capacity: 500, windowMs: 60_000 },
  // PLH-3y-5: SCIM 2.0 provisioning endpoints, keyed per org. Okta bursts
  // hard on the initial directory sync, so the ceiling is high (600/min/org).
  // Keyed by org, not IP, since a single IdP connector drives all the traffic.
  scim: { capacity: 600, windowMs: 60_000 },
  generic: { capacity: 60, windowMs: 60_000 },
};

// ---------------------------------------------------------------------------
// Upstash backend.
// ---------------------------------------------------------------------------
// One Ratelimit instance per bucket; @upstash/ratelimit caches the redis
// SHA so the second call is one round-trip. We create instances lazily so
// the Redis client never spins up when the env vars are missing.

let _redis: Redis | null = null;
function redis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

const _limiters = new Map<string, Ratelimit>();
function upstashLimiter(name: string, bucket: Bucket): Ratelimit | null {
  const r = redis();
  if (!r) return null;
  const cached = _limiters.get(name);
  if (cached) return cached;
  const made = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(bucket.capacity, `${bucket.windowMs} ms`),
    analytics: false,
    prefix: `rl:${name}`,
  });
  _limiters.set(name, made);
  return made;
}

// ---------------------------------------------------------------------------
// In-memory fallback (same code as before).
// ---------------------------------------------------------------------------
const hits = new Map<string, Map<string, number[]>>();

function pruneAndCount(arr: number[], windowMs: number, now: number): number {
  const cutoff = now - windowMs;
  let write = 0;
  for (let read = 0; read < arr.length; read++) {
    if (arr[read] >= cutoff) {
      arr[write++] = arr[read];
    }
  }
  arr.length = write;
  return arr.length;
}

function inMemory(bucketName: string, key: string, bucket: Bucket): RateLimitResult {
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
    const oldest = arr[0] ?? now;
    const retryAfterMs = Math.max(1000, oldest + bucket.windowMs - now);
    return { allowed: false, retryAfterMs, remaining: 0 };
  }
  arr.push(now);
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

// ---------------------------------------------------------------------------
// Public surface. Async because Upstash is a network call; the previous
// sync sites had to convert to `await rateLimit(...)`.
// ---------------------------------------------------------------------------

export async function rateLimit(
  bucketName: keyof typeof BUCKETS | string,
  key: string
): Promise<RateLimitResult> {
  const bucket = BUCKETS[bucketName] ?? BUCKETS.generic;
  const limiter = upstashLimiter(String(bucketName), bucket);
  if (limiter) {
    const res = await limiter.limit(key);
    const retryAfterMs = Math.max(0, res.reset - Date.now());
    return {
      allowed: res.success,
      retryAfterMs: res.success ? 0 : Math.max(1000, retryAfterMs),
      remaining: res.remaining,
    };
  }
  return inMemory(String(bucketName), key, bucket);
}

/**
 * Best-effort caller IP. Vercel sets x-forwarded-for; the leftmost entry
 * is the original client.
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

/** True when Upstash is wired and the limiter is using it. */
export function isDistributedRateLimitEnabled(): boolean {
  return redis() !== null;
}

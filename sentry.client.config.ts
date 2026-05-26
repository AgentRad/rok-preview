// Loaded on the browser. Gated on NEXT_PUBLIC_SENTRY_DSN being set; when
// missing, init runs with an empty DSN and Sentry becomes a no-op (events
// are dropped at the SDK layer, no network calls). That lets us ship the
// instrumentation without forcing every preview deploy to have a DSN.
//
// Trimmed surface area: error capture only. Replay and BrowserProfiling
// integrations are NOT registered (Replay alone is ~50 KB gzipped). Tracing
// runs at sample rate 0 so the browserTracingIntegration code stays out of
// the hot path. If we ever need distributed traces, raise tracesSampleRate
// per environment via env var.

import * as Sentry from "@sentry/nextjs";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || "";

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    tracesSampleRate: 0,
  });
}

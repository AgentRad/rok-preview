// Loaded on the browser. Gated on NEXT_PUBLIC_SENTRY_DSN being set; when
// missing, init runs with an empty DSN and Sentry becomes a no-op (events
// are dropped at the SDK layer, no network calls). That lets us ship the
// instrumentation without forcing every preview deploy to have a DSN.

import * as Sentry from "@sentry/nextjs";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || "";

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    // Low sample rate on preview/dev to avoid burning the free 5k events
    // tier on noise. Production can be tuned via SENTRY_TRACES_SAMPLE_RATE.
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0.1),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

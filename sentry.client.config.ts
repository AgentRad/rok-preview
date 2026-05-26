// Loaded on the browser. Gated on NEXT_PUBLIC_SENTRY_DSN being set; when
// missing, init runs with an empty DSN and Sentry becomes a no-op (events
// are dropped at the SDK layer, no network calls). That lets us ship the
// instrumentation without forcing every preview deploy to have a DSN.
//
// P11.9: integrations explicitly emptied. tracesSampleRate:0 keeps trace
// data from being SENT, but BrowserTracing and the other defaults still
// install and run on every page (long-task observers, navigation hooks,
// PerformanceObserver init). That work showed up as TBT after P11.8. With
// integrations:[] only window.onerror / unhandledrejection capture remains.
// If we ever need distributed traces, register browserTracingIntegration
// here explicitly and raise tracesSampleRate per env.

import * as Sentry from "@sentry/nextjs";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || "";

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    tracesSampleRate: 0,
    integrations: [],
  });
}

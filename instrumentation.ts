// Next.js entry point for server-side instrumentation. The router loads
// this before any route handler runs and routes to the right config file
// based on the runtime that triggered the request. Required by
// @sentry/nextjs >= 8.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Sentry helper that wraps thrown errors with request context. Pulled out
// of register() so the same path is used for nodejs + edge.
import * as Sentry from "@sentry/nextjs";
export const onRequestError = Sentry.captureRequestError;

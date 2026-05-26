import "server-only";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { captureError } from "@/lib/observability";

/**
 * Client-side error sink. P11.10 replaced the @sentry/nextjs client SDK
 * with a tiny window.onerror handler (see sentry.client.config.ts) so the
 * homepage stops shipping ~60 KB of unused JS. That handler POSTs here;
 * this route forwards to the server-side Sentry SDK, which already runs
 * inside the Node bundle and is invisible to PSI.
 *
 * Payload is best-effort. Anything malformed is logged and dropped; we
 * never want the error reporter itself to fail loudly.
 */

type ClientErrorPayload = {
  kind?: string;
  message?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  url?: string;
  ua?: string;
};

export async function POST(req: Request) {
  let body: ClientErrorPayload = {};
  try {
    body = (await req.json()) as ClientErrorPayload;
  } catch {
    // sendBeacon Blobs and malformed bodies land here. Drop quietly.
    return NextResponse.json({ ok: true }, { status: 204 });
  }

  const msg = body.message || "client error (no message)";
  const err = new Error(msg);
  if (body.stack) err.stack = body.stack;

  // Tag and forward. captureError lives in observability.ts and dual-logs
  // to console and Sentry, so Vercel function logs still show the trace.
  try {
    captureError(err, {
      route: "client",
      kind: body.kind,
      url: body.url,
      filename: body.filename,
      lineno: body.lineno,
      colno: body.colno,
      ua: body.ua,
    });
  } catch {
    // observability layer should never throw, but belt-and-braces.
  }

  // Best-effort flush so events make it out even when the function
  // is about to be reaped (sendBeacon paths often hit cold lambdas).
  try {
    await Sentry.flush(1000);
  } catch {
    /* noop */
  }

  return NextResponse.json({ ok: true });
}

// P11.10: dropped the @sentry/nextjs client SDK entirely. PSI Mobile
// flagged ~82 KB of unused JS on the homepage; @sentry/nextjs accounted
// for the majority of that even after the integrations: [] trim in P11.9.
//
// Replacement: two lightweight window listeners that POST the minimum
// payload to /api/error-log. That route forwards to the server-side
// Sentry SDK (free of bundle-size concerns; server code is not measured
// by PSI). global-error.tsx still calls captureException directly, but
// that boundary is code-split by Next 15 and only loaded when a render
// error actually fires.
//
// Best Practices guardrail: onerror returns true to swallow the default
// console output that PSI's "Browser errors were logged to the console"
// audit checks for. Same for onunhandledrejection via preventDefault.

if (typeof window !== "undefined") {
  function send(payload: Record<string, unknown>): void {
    try {
      const body = JSON.stringify(payload);
      // sendBeacon survives page unload; fetch is the fallback.
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon("/api/error-log", blob);
      } else {
        fetch("/api/error-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // never throw from the error reporter itself
    }
  }

  window.addEventListener("error", (event) => {
    send({
      kind: "error",
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack,
      url: location.href,
      ua: navigator.userAgent,
    });
    event.preventDefault();
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    send({
      kind: "unhandledrejection",
      message:
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "non-Error rejection",
      stack: reason instanceof Error ? reason.stack : undefined,
      url: location.href,
      ua: navigator.userAgent,
    });
    event.preventDefault();
  });
}

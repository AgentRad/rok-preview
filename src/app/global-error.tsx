"use client";

import { captureException } from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main
          style={{
            padding: "80px 24px",
            maxWidth: 640,
            margin: "0 auto",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <h1 style={{ fontSize: 28, marginBottom: 12 }}>Something went wrong.</h1>
          <p style={{ marginBottom: 24, color: "#555" }}>
            We have been notified and will look into it. Try again, or head back
            home.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "10px 18px",
              background: "#1a1916",
              color: "#fff",
              border: 0,
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

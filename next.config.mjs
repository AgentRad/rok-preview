import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Allow-list for next/image optimizer. Anything outside this list is
    // rendered via the `unoptimized` prop so we still get sizing + lazy
    // loading without the optimizer needing to fetch arbitrary URLs.
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      { protocol: "https", hostname: "files.stripe.com" },
      { protocol: "https", hostname: "resend.com" },
      { protocol: "https", hostname: "ui-avatars.com" },
    ],
  },
  async rewrites() {
    return [
      // Browsers auto-request /favicon.ico and /apple-touch-icon.png from
      // any site. We serve a single SVG mark for everything; route those
      // legacy paths to it so the network tab stays clean (no 404s).
      { source: "/favicon.ico", destination: "/favicon.svg" },
      { source: "/apple-touch-icon.png", destination: "/favicon.svg" },
      { source: "/apple-touch-icon-precomposed.png", destination: "/favicon.svg" },
    ];
  },
};

// Sentry wrapping. Source-map upload is gated on SENTRY_AUTH_TOKEN being
// set; absent that, the wrapper is still applied but skips the upload step
// so a preview deploy without the secret still builds cleanly.
const sentryWebpackPluginOptions = {
  silent: !process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG || "partsport",
  project: process.env.SENTRY_PROJECT || "partsport-web",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  webpack: { treeshake: { removeDebugLogging: true } },
  widenClientFileUpload: false,
  tunnelRoute: "/monitoring",
};

export default withSentryConfig(nextConfig, sentryWebpackPluginOptions);

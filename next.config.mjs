import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Inline above-the-fold critical CSS via Critters so the first paint
    // doesn't wait for the full stylesheet to download. The full sheet is
    // still requested with media="print" + onload swap so subsequent
    // paints get the rest.
    optimizeCss: true,
    // Honor the package.json browserslist target inside SWC so legacy
    // polyfills for already-supported features get dropped from the
    // client bundle. We target Chrome/Firefox/Edge >= 90 and Safari >= 14.
    browsersListForSwc: true,
  },
  images: {
    // Allow-list for next/image optimizer. Anything outside this list is
    // rendered via the `unoptimized` prop so we still get sizing + lazy
    // loading without the optimizer needing to fetch arbitrary URLs.
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      { protocol: "https", hostname: "files.stripe.com" },
      { protocol: "https", hostname: "resend.com" },
      { protocol: "https", hostname: "ui-avatars.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
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

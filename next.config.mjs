/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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

export default nextConfig;

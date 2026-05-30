import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * Dynamic robots.txt so the Sitemap URL tracks the actual deploy host
 * (VERCEL_URL, NEXT_PUBLIC_SITE_URL, or the preview fallback in siteUrl()).
 * Auth-gated routes are disallowed.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/account",
          "/settings",
          "/supplier",
          "/admin",
          "/ops",
          "/oem",
          "/orders/",
          "/quotes/",
          "/api/",
        ],
      },
    ],
    sitemap: siteUrl("/sitemap.xml"),
  };
}

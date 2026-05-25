import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { siteUrl } from "@/lib/site-url";
import { manufacturerSlug } from "@/lib/manufacturer-slug";

export const dynamic = "force-dynamic";

/**
 * Dynamic sitemap. Pulls the host from VERCEL_URL / NEXT_PUBLIC_SITE_URL
 * via siteUrl() so the preview deploy and a future production domain are
 * both correct. Lists:
 *
 *   - Static marketing routes (high priority, weekly cadence)
 *   - Every active product detail page
 *   - Every brand storefront (claimed + stub)
 *
 * Auth-only routes (/account, /supplier, /admin, /ops, /oem) are
 * intentionally omitted; crawlers see them as 401s.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPaths: { path: string; priority: number; changeFrequency: "weekly" | "daily" | "monthly" }[] = [
    { path: "/", priority: 1.0, changeFrequency: "weekly" },
    { path: "/catalog", priority: 0.9, changeFrequency: "daily" },
    { path: "/manufacturers", priority: 0.8, changeFrequency: "weekly" },
    { path: "/suppliers", priority: 0.7, changeFrequency: "monthly" },
    { path: "/how-it-works", priority: 0.6, changeFrequency: "monthly" },
    { path: "/login", priority: 0.3, changeFrequency: "monthly" },
    { path: "/register", priority: 0.4, changeFrequency: "monthly" },
  ];

  const [products, productManufacturers, oemUsers] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      select: { sku: true, updatedAt: true },
    }),
    prisma.product.findMany({
      where: { active: true },
      select: { manufacturer: true },
      distinct: ["manufacturer"],
    }),
    prisma.user.findMany({
      where: { role: "MANUFACTURER", manufacturerName: { not: null } },
      select: { manufacturerName: true },
    }),
  ]);

  // Dedupe brand slugs (claimed + product-only) so we don't list the same
  // storefront twice.
  const brandSlugs = new Set<string>();
  for (const p of productManufacturers) {
    brandSlugs.add(manufacturerSlug(p.manufacturer));
  }
  for (const u of oemUsers) {
    if (u.manufacturerName) brandSlugs.add(manufacturerSlug(u.manufacturerName));
  }

  return [
    ...staticPaths.map((s) => ({
      url: siteUrl(s.path),
      lastModified: now,
      changeFrequency: s.changeFrequency,
      priority: s.priority,
    })),
    ...products.map((p) => ({
      url: siteUrl(`/product/${p.sku}`),
      lastModified: p.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...Array.from(brandSlugs).map((slug) => ({
      url: siteUrl(`/manufacturers/${slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}

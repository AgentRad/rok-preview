import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canonicalizeManufacturerName,
  manufacturerSlug,
} from "@/lib/manufacturer-slug";

export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : null;
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  // Canonicalize the OEM brand name and suggest a canonical Product.manufacturer
  // string if one already exists with the same slug. This is the only place an
  // OEM sets their manufacturerName, and we want the storefront link
  // (/manufacturers/[slug]) to resolve to actual products on day 1.
  let manufacturerName: string | null | undefined = undefined;
  let brandMismatchWarning: string | null = null;
  if (typeof body.manufacturerName === "string") {
    const raw = body.manufacturerName.trim();
    if (raw === "") {
      manufacturerName = null;
    } else {
      const canonical = canonicalizeManufacturerName(raw);
      const slug = manufacturerSlug(canonical);
      // If a Product.manufacturer with the same slug already exists, prefer
      // that exact string so the OEM's storefront immediately ties to the
      // active catalog. Otherwise, accept the canonicalized typed-in name.
      const matching = await prisma.product.findMany({
        where: { active: true },
        select: { manufacturer: true },
        distinct: ["manufacturer"],
      });
      const exact = matching.find(
        (m) => manufacturerSlug(m.manufacturer) === slug
      );
      manufacturerName = exact ? exact.manufacturer : canonical;
      // Soft warning when the OEM's brand name has no matching products on
      // the platform. We don't reject (they might be the first OEM listing
      // for a brand whose distributors haven't joined yet), but the UI
      // surfaces the warning so the OEM knows their storefront will start
      // empty.
      if (!exact) {
        brandMismatchWarning = `No products on PartsPort match "${canonical}" yet. Your storefront will be empty until a distributor lists products with this exact manufacturer name. Double-check the spelling, or contact support if you expect existing listings to roll up to your brand.`;
      }
    }
  }

  if (user.role === "MANUFACTURER" && manufacturerName !== undefined) {
    // Check uniqueness: another MANUFACTURER user can't already hold this brand.
    if (manufacturerName !== null) {
      const conflict = await prisma.user.findFirst({
        where: {
          manufacturerName,
          NOT: { id: user.id },
        },
        select: { id: true },
      });
      if (conflict) {
        return NextResponse.json(
          {
            error: `"${manufacturerName}" is already claimed by another account. If you believe this is your brand, contact support.`,
          },
          { status: 409 }
        );
      }
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      name,
      ...(user.role === "MANUFACTURER" && manufacturerName !== undefined
        ? { manufacturerName }
        : {}),
    },
  });

  return NextResponse.json({
    ok: true,
    ...(brandMismatchWarning ? { warning: brandMismatchWarning } : {}),
  });
}

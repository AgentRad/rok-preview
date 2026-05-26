import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canonicalizeManufacturerName,
  manufacturerSlug,
} from "@/lib/manufacturer-slug";
import { normalizeName } from "@/lib/user-input";

export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  // Name is optional in this PATCH: if the caller doesn't include it, we
  // leave it alone. If they include it as an empty string, that's a
  // validation error. Lets the CompanyProfileForm update just the company
  // fields without re-sending the user's name.
  let name: string | undefined = undefined;
  if (body.name !== undefined) {
    // PLH-1 commit 2: apply the same normalization as /api/auth/register
    // (trim, NFKC, strip zero-width, cap 80 chars).
    const cleaned = normalizeName(body.name);
    if (!cleaned) {
      return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
    }
    name = cleaned;
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

  // Buyer (and any role) company profile. Optional; missing leaves the
  // current value alone. companyLogoUrl can be cleared by passing "".
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (typeof body.companyName === "string") {
    const trimmed = body.companyName.trim();
    data.companyName = trimmed === "" ? null : trimmed.slice(0, 200);
  }
  if (typeof body.companyLogoUrl === "string") {
    const url = body.companyLogoUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      return NextResponse.json(
        { error: "Logo URL must start with https:// or http://." },
        { status: 400 }
      );
    }
    data.companyLogoUrl = url === "" ? null : url;
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
      ...data,
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

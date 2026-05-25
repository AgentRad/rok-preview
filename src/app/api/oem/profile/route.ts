import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * OEM (MANUFACTURER role) updates their public storefront copy.
 * Logo is uploaded separately via /api/oem/profile/logo (Vercel Blob path).
 */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "MANUFACTURER") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const data: {
    manufacturerTagline?: string;
    manufacturerBio?: string;
    manufacturerWebsite?: string;
    manufacturerLogoUrl?: string | null;
  } = {};
  if (typeof body.tagline === "string") {
    data.manufacturerTagline = body.tagline.slice(0, 140).trim();
  }
  if (typeof body.bio === "string") {
    data.manufacturerBio = body.bio.slice(0, 1200).trim();
  }
  if (typeof body.website === "string") {
    const w = body.website.trim();
    if (w && !/^https?:\/\//i.test(w)) {
      return NextResponse.json(
        { error: "Website URL must start with https:// or http://." },
        { status: 400 }
      );
    }
    data.manufacturerWebsite = w;
  }
  if (typeof body.logoUrl === "string") {
    data.manufacturerLogoUrl = body.logoUrl.trim() || null;
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
    select: {
      manufacturerName: true,
      manufacturerTagline: true,
      manufacturerBio: true,
      manufacturerLogoUrl: true,
      manufacturerWebsite: true,
    },
  });
  return NextResponse.json({ ok: true, user: updated });
}

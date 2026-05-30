import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

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
  // PLH-2 Phase 4c (C3): rate-limit OEM profile edits.
  const rl = await rateLimit("generic", `oem:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }
  const body = await req.json().catch(() => ({}));
  const data: {
    manufacturerTagline?: string;
    manufacturerBio?: string;
    manufacturerWebsite?: string;
    manufacturerLogoUrl?: string | null;
  } = {};
  if (typeof body.tagline === "string") {
    // PLH-3c F6: trim before slicing so the user-visible character count
    // doesn't drift after a save (slice-then-trim could land below the
    // 140 cap whenever the input had trailing whitespace).
    data.manufacturerTagline = body.tagline.trim().slice(0, 140);
  }
  if (typeof body.bio === "string") {
    data.manufacturerBio = body.bio.trim().slice(0, 1200);
  }
  if (typeof body.website === "string") {
    // PLH-2 Phase 4c (C4): hard validation of the website URL. Reject
    // anything that isn't http(s), parse-fail, or longer than 200 chars.
    // Blocks javascript:, data:, file:, and other smuggle vectors that
    // would otherwise render as a clickable link on the public storefront.
    const raw = body.website.trim();
    if (raw === "") {
      data.manufacturerWebsite = "";
    } else {
      if (raw.length > 200) {
        return NextResponse.json(
          { error: "Website URL is too long (max 200 characters)." },
          { status: 400 }
        );
      }
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        return NextResponse.json(
          { error: "Website URL is malformed. Include https:// at the start." },
          { status: 400 }
        );
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return NextResponse.json(
          { error: "Website URL must use http:// or https://." },
          { status: 400 }
        );
      }
      // Normalize host to lowercase. Keep path/query case as the OEM typed it.
      parsed.hostname = parsed.hostname.toLowerCase();
      data.manufacturerWebsite = parsed.toString();
    }
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

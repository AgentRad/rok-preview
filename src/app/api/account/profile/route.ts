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

  let pendingNotice: string | null = null;
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
      // PLH-3c F3: don't write User.manufacturerName directly. Create or
      // update a PENDING ManufacturerApplication for admin review. The
      // storefront stays dark and the dropdown stays empty until an
      // admin APPROVES.
      const existing = await prisma.manufacturerApplication.findUnique({
        where: { userId: user.id },
      });
      if (!existing || existing.status !== "APPROVED") {
        await prisma.manufacturerApplication.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            manufacturerName,
            status: "PENDING",
          },
          update: {
            manufacturerName,
            status: "PENDING",
            submittedAt: new Date(),
            reviewedAt: null,
            reviewedByUserId: null,
            rejectionReason: null,
          },
        });
        pendingNotice = `Your brand claim for "${manufacturerName}" is pending admin review. Your storefront stays hidden until it's approved.`;
        try {
          const { sendOemApplicationSubmitted } = await import("@/lib/email");
          await sendOemApplicationSubmitted({
            userEmail: user.email,
            userName: user.name,
            manufacturerName,
          });
        } catch {
          // best-effort
        }
      } else if (existing.status === "APPROVED" && existing.manufacturerName !== manufacturerName) {
        // Re-submission with a different brand name: park as PENDING and
        // clear the live storefront until admin re-approves.
        await prisma.manufacturerApplication.update({
          where: { userId: user.id },
          data: {
            manufacturerName,
            status: "PENDING",
            submittedAt: new Date(),
            reviewedAt: null,
            reviewedByUserId: null,
            rejectionReason: null,
          },
        });
        data.manufacturerName = null;
        pendingNotice = `Brand name changed. Your storefront is offline until admin re-approves "${manufacturerName}".`;
      }
    } else {
      // Clearing the brand name. Allowed; also wipe any pending application
      // so the next set creates a fresh PENDING row.
      data.manufacturerName = null;
      await prisma.manufacturerApplication.deleteMany({
        where: { userId: user.id, status: { not: "APPROVED" } },
      });
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data,
  });

  return NextResponse.json({
    ok: true,
    ...(brandMismatchWarning ? { warning: brandMismatchWarning } : {}),
    ...(pendingNotice ? { pending: pendingNotice } : {}),
  });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveSupplierContext, canManageTeam } from "@/lib/supplier-access";

export const runtime = "nodejs";

/**
 * Supplier-side update of their own public profile fields. Catalog/inventory
 * data has its own routes. Admins flow through here when acting-as a supplier.
 */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const ctx = await getActiveSupplierContext(user);
  if (!ctx) {
    return NextResponse.json({ error: "No active supplier." }, { status: 403 });
  }
  // Only owners/admins (or admin acting-as) can edit profile-level fields.
  if (!canManageTeam(ctx.role) && !ctx.actingAsAdmin) {
    return NextResponse.json(
      { error: "Only the supplier owner or an admin can edit the profile." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const data: {
    logoUrl?: string | null;
    website?: string;
    description?: string;
    certifications?: string;
  } = {};
  if (typeof body.logoUrl === "string") {
    const trimmed = body.logoUrl.trim();
    data.logoUrl = trimmed === "" ? null : trimmed;
  }
  if (typeof body.website === "string") data.website = body.website.trim();
  if (typeof body.description === "string") {
    data.description = body.description.trim();
  }
  if (typeof body.certifications === "string") {
    data.certifications = body.certifications.trim();
  }

  const updated = await prisma.supplier.update({
    where: { id: ctx.supplier.id },
    data,
  });
  return NextResponse.json({ ok: true, supplier: updated });
}

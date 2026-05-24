import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Admin-only update of a supplier's public profile and trust metadata.
 * Anything supplier-managed (catalog, stock, prices, etc.) goes through the
 * existing supplier endpoints with the admin acting-as override.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { id } = await params;
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) {
    return NextResponse.json(
      { error: "Supplier not found." },
      { status: 404 }
    );
  }
  const body = await req.json().catch(() => ({}));

  const data: {
    name?: string;
    contactEmail?: string;
    certifications?: string;
    logoUrl?: string | null;
    website?: string;
    description?: string;
    status?: "PENDING" | "APPROVED" | "SUSPENDED";
  } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.contactEmail === "string" && body.contactEmail.trim()) {
    data.contactEmail = body.contactEmail.trim().toLowerCase();
  }
  if (typeof body.certifications === "string") {
    data.certifications = body.certifications.trim();
  }
  if (typeof body.logoUrl === "string") {
    const trimmed = body.logoUrl.trim();
    data.logoUrl = trimmed === "" ? null : trimmed;
  }
  if (typeof body.website === "string") data.website = body.website.trim();
  if (typeof body.description === "string") {
    data.description = body.description.trim();
  }
  if (
    body.status === "PENDING" ||
    body.status === "APPROVED" ||
    body.status === "SUSPENDED"
  ) {
    data.status = body.status;
  }

  const updated = await prisma.supplier.update({ where: { id }, data });
  return NextResponse.json({ ok: true, supplier: updated });
}

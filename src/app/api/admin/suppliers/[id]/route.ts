import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog, type AuditAction } from "@/lib/audit";
import { computeReadiness } from "@/lib/supplier-access";

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
    rating?: number;
    onTimeRate?: number;
    publicVisible?: boolean;
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
  // Status: validate AND reject. Previously we silently dropped invalid
  // statuses, which made the API lie about what it persisted. UI guards
  // through a select but the API should be honest too.
  if (body.status !== undefined) {
    if (
      body.status === "PENDING" ||
      body.status === "APPROVED" ||
      body.status === "SUSPENDED"
    ) {
      data.status = body.status;
    } else {
      return NextResponse.json(
        {
          error: `Invalid status "${String(body.status)}". Must be PENDING, APPROVED, or SUSPENDED.`,
        },
        { status: 400 }
      );
    }
  }
  if (body.rating !== undefined) {
    if (
      typeof body.rating === "number" &&
      Number.isFinite(body.rating) &&
      body.rating >= 0 &&
      body.rating <= 5
    ) {
      data.rating = body.rating;
    } else {
      return NextResponse.json(
        { error: `Invalid rating "${String(body.rating)}". Must be 0 to 5.` },
        { status: 400 }
      );
    }
  }
  if (body.publicVisible !== undefined) {
    if (typeof body.publicVisible !== "boolean") {
      return NextResponse.json(
        { error: "publicVisible must be a boolean." },
        { status: 400 }
      );
    }
    data.publicVisible = body.publicVisible;
  }
  if (body.onTimeRate !== undefined) {
    if (
      typeof body.onTimeRate === "number" &&
      Number.isFinite(body.onTimeRate) &&
      body.onTimeRate >= 0 &&
      body.onTimeRate <= 100
    ) {
      data.onTimeRate = body.onTimeRate;
    } else {
      return NextResponse.json(
        {
          error: `Invalid onTimeRate "${String(body.onTimeRate)}". Must be 0 to 100.`,
        },
        { status: 400 }
      );
    }
  }

  // PLH-1 commit 3: server-side go-live gate. Admin can hide a live
  // supplier any time, but flipping hidden -> live requires all 10 readiness
  // items to pass. UI gating is belt-and-braces; this is the real lock.
  if (
    data.publicVisible === true &&
    supplier.publicVisible === false
  ) {
    const [docs, productCount] = await Promise.all([
      prisma.supplierDocument.findMany({
        where: { supplierId: supplier.id },
        select: { kind: true, status: true },
      }),
      prisma.product.count({ where: { supplierId: supplier.id, active: true } }),
    ]);
    const readiness = computeReadiness(
      {
        status: data.status ?? supplier.status,
        logoUrl: supplier.logoUrl,
        description: data.description ?? supplier.description,
        certifications: data.certifications ?? supplier.certifications,
        website: data.website ?? supplier.website,
        bankInfoStatus: supplier.bankInfoStatus,
        stripePayoutsEnabled: supplier.stripePayoutsEnabled,
        stripeAccountId: supplier.stripeAccountId,
      },
      docs,
      productCount
    );
    if (!readiness.ready) {
      const missingItems = readiness.items
        .filter((i) => !i.done)
        .map((i) => i.label);
      return NextResponse.json(
        {
          error: `Cannot go live. ${readiness.done}/${readiness.total} onboarding items complete.`,
          missing: missingItems,
        },
        { status: 400 }
      );
    }
  }

  const updated = await prisma.supplier.update({ where: { id }, data });

  // Audit-log the kinds of changes a regulator or future-you cares about.
  // Plain edits (rating tweak, description tidy) collapse to one summary
  // row; status/visibility/legal-flag flips get their own action verbs so
  // a filter in /admin/audit isolates them cleanly.
  const changes: { action: AuditAction; summary: string }[] = [];
  if (data.status && data.status !== supplier.status) {
    const act: AuditAction =
      data.status === "APPROVED"
        ? "SUPPLIER_APPROVED"
        : data.status === "SUSPENDED"
          ? "SUPPLIER_SUSPENDED"
          : "SUPPLIER_UPDATED";
    changes.push({
      action: act,
      summary: `Set status ${supplier.status} -> ${data.status}`,
    });
  }
  if (
    data.publicVisible !== undefined &&
    data.publicVisible !== supplier.publicVisible
  ) {
    changes.push({
      action: "SUPPLIER_VISIBILITY_FLIPPED",
      summary: `Visibility ${supplier.publicVisible ? "live" : "hidden"} -> ${data.publicVisible ? "live" : "hidden"}`,
    });
  }
  // Everything else (rating, on-time, name, etc.) rolls up.
  const otherKeys = Object.keys(data).filter(
    (k) => k !== "status" && k !== "publicVisible"
  );
  if (otherKeys.length > 0 && changes.length === 0) {
    changes.push({
      action: "SUPPLIER_UPDATED",
      summary: `Edited fields: ${otherKeys.join(", ")}`,
    });
  }
  for (const c of changes) {
    await writeAuditLog({
      actor: user,
      action: c.action,
      targetType: "Supplier",
      targetId: supplier.id,
      summary: `${supplier.name}: ${c.summary}`,
      metadata: { supplierName: supplier.name, changes: data },
    });
  }
  return NextResponse.json({ ok: true, supplier: updated });
}

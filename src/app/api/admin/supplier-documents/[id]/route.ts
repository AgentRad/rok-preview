import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog, type AuditAction } from "@/lib/audit";
import { sendSupplierDocReviewed } from "@/lib/email";

export const runtime = "nodejs";

/**
 * Admin sets a document's status (APPROVED / REJECTED / PENDING) and an
 * optional reviewer note. The note surfaces in the supplier's dashboard
 * so they know what to fix on a rejection.
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
  const body = await req.json().catch(() => ({}));
  const status = String(body.status || "").toUpperCase();
  if (status !== "APPROVED" && status !== "REJECTED" && status !== "PENDING") {
    return NextResponse.json(
      { error: "status must be APPROVED, REJECTED, or PENDING." },
      { status: 400 }
    );
  }
  const reviewNote =
    typeof body.reviewNote === "string"
      ? body.reviewNote.trim().slice(0, 500)
      : undefined;

  const existing = await prisma.supplierDocument.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const updated = await prisma.supplierDocument.update({
    where: { id },
    data: {
      status,
      reviewedAt: new Date(),
      reviewedBy: user.email,
      ...(reviewNote !== undefined ? { reviewNote } : {}),
    },
  });
  const action: AuditAction =
    status === "APPROVED"
      ? "SUPPLIER_DOC_APPROVED"
      : status === "REJECTED"
        ? "SUPPLIER_DOC_REJECTED"
        : "SUPPLIER_DOC_PENDING";
  await writeAuditLog({
    actor: user,
    action,
    targetType: "SupplierDocument",
    targetId: updated.id,
    summary: `${updated.kind} (${updated.filename}) ${status.toLowerCase()}${reviewNote ? `: ${reviewNote}` : ""}`,
    metadata: { supplierId: updated.supplierId, kind: updated.kind },
  });

  // PLH-1 commit 4: tell the supplier their document was reviewed.
  // Gated on RESEND_API_KEY (the helper no-ops without it).
  if (process.env.RESEND_API_KEY) {
    try {
      const supplier = await prisma.supplier.findUnique({
        where: { id: updated.supplierId },
        select: { name: true, contactEmail: true },
      });
      if (supplier?.contactEmail) {
        await sendSupplierDocReviewed({
          to: supplier.contactEmail,
          supplierName: supplier.name,
          kind: updated.kind,
          status,
          reviewNote: updated.reviewNote ?? null,
        });
      }
    } catch {
      // Non-fatal: a failed notification email doesn't undo the review.
    }
  }

  return NextResponse.json({ ok: true, document: updated });
}

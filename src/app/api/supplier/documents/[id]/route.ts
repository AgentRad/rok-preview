import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canManageDocuments,
  effectiveAccessToSupplier,
} from "@/lib/supplier-access";

export const runtime = "nodejs";

/**
 * Supplier can remove their own PENDING or REJECTED docs (e.g. they uploaded
 * the wrong file). Approved docs are immutable from the supplier side; only
 * an admin can re-status those. This keeps the audit trail honest.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const { id } = await params;
  const doc = await prisma.supplierDocument.findUnique({ where: { id } });
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  const access = await effectiveAccessToSupplier(user, doc.supplierId);
  if (!access.ok || !canManageDocuments(access.role)) {
    return NextResponse.json(
      { error: "Not authorized to manage this supplier's documents." },
      { status: 403 }
    );
  }
  if (doc.status === "APPROVED") {
    return NextResponse.json(
      {
        error:
          "Approved documents can't be removed by the supplier. Contact admin if this needs to change.",
      },
      { status: 400 }
    );
  }
  await prisma.supplierDocument.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

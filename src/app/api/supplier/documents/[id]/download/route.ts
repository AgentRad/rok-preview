import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canManageDocuments,
  effectiveAccessToSupplier,
} from "@/lib/supplier-access";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * PLH-1 commit 3: authenticated download for a supplier document. The
 * blob is private; only OWNER or ADMIN teammates of the owning supplier
 * (the same tier that uploads/manages docs) can read it. Every fetch
 * lands in the audit log so we can show who saw a W9 or COI.
 */
export async function GET(
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
      { error: "Not authorized to view this document." },
      { status: 403 }
    );
  }

  try {
    const res = await get(doc.url, { access: "private" });
    if (!res) {
      return NextResponse.json(
        { error: "Document is no longer available." },
        { status: 404 }
      );
    }
    await writeAuditLog({
      actor: user,
      action: "SUPPLIER_DOC_VIEWED",
      targetType: "SupplierDocument",
      targetId: doc.id,
      summary: `${user.email} viewed ${doc.kind} (${doc.filename}) for supplier ${doc.supplierId}`,
      metadata: {
        docId: doc.id,
        kind: doc.kind,
        supplierId: doc.supplierId,
        viewerEmail: user.email,
      },
    });
    const contentType =
      res.headers.get("content-type") || "application/octet-stream";
    return new Response(res.stream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(
          doc.filename || `${doc.kind}.bin`
        )}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    captureError(err, {
      subsystem: "supplier-doc-download",
      docId: doc.id,
    });
    return NextResponse.json(
      { error: "Could not retrieve document." },
      { status: 500 }
    );
  }
}

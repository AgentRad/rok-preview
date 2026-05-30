import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * PLH-1 commit 3: admin-only authenticated download for a supplier doc.
 * Mirror of the supplier-side route but gated on platform ADMIN role.
 * Every read is audited so we can answer "who saw this W9 and when".
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { id } = await params;
  const doc = await prisma.supplierDocument.findUnique({ where: { id } });
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
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
      summary: `Admin ${user.email} viewed ${doc.kind} (${doc.filename}) for supplier ${doc.supplierId}`,
      metadata: {
        docId: doc.id,
        kind: doc.kind,
        supplierId: doc.supplierId,
        viewerEmail: user.email,
        viewerRole: "ADMIN",
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
      subsystem: "admin-supplier-doc-download",
      docId: doc.id,
    });
    return NextResponse.json(
      { error: "Could not retrieve document." },
      { status: 500 }
    );
  }
}

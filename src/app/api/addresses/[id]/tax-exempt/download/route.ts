import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * PLH-2 Phase 4d (D4): authenticated download for a buyer's tax-exempt
 * certificate. The blob is private; only the owning buyer or an ADMIN
 * can read it. Every fetch lands in the audit log
 * (TAX_EXEMPT_DOC_VIEWED) so we can prove who saw a resale or EIN cert.
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
  const address = await prisma.address.findUnique({
    where: { id },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!address || !address.taxExemptCertificateUrl) {
    return NextResponse.json({ error: "Certificate not found." }, { status: 404 });
  }
  const isOwner = address.userId === user.id;
  const isAdmin = user.role === "ADMIN";
  if (!isOwner && !isAdmin) {
    return NextResponse.json(
      { error: "Not authorized to view this certificate." },
      { status: 403 }
    );
  }

  const certUrl = address.taxExemptCertificateUrl;

  // URL-paste path: the cert lives on an external host. Redirect to it
  // rather than proxy. (Owner/admin only; still audited.)
  if (!/vercel-storage|blob\.vercel/i.test(certUrl)) {
    await writeAuditLog({
      actor: user,
      action: "TAX_EXEMPT_DOC_VIEWED",
      targetType: "Address",
      targetId: address.id,
      summary: `${user.email} opened tax-exempt cert for address ${address.id} (external URL)`,
      metadata: {
        addressId: address.id,
        ownerId: address.userId,
        viewerEmail: user.email,
        external: true,
      },
    });
    return NextResponse.redirect(certUrl, 302);
  }

  try {
    const res = await get(certUrl, { access: "private" });
    if (!res) {
      return NextResponse.json(
        { error: "Certificate is no longer available." },
        { status: 404 }
      );
    }
    await writeAuditLog({
      actor: user,
      action: "TAX_EXEMPT_DOC_VIEWED",
      targetType: "Address",
      targetId: address.id,
      summary: `${user.email} viewed tax-exempt cert for address ${address.id}`,
      metadata: {
        addressId: address.id,
        ownerId: address.userId,
        viewerEmail: user.email,
      },
    });
    const contentTypeHdr =
      res.headers.get("content-type") || "application/octet-stream";
    return new Response(res.stream, {
      status: 200,
      headers: {
        "Content-Type": contentTypeHdr,
        "Content-Disposition": `attachment; filename="tax-exempt-${address.id}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    captureError(err, {
      subsystem: "tax-exempt-download",
      addressId: address.id,
    });
    return NextResponse.json(
      { error: "Could not retrieve certificate." },
      { status: 500 }
    );
  }
}

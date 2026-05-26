import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canManageDocuments,
  getActiveSupplierContext,
  SUPPLIER_DOC_KINDS,
  type SupplierDocKind,
} from "@/lib/supplier-access";
import { detectMagic, safeExt } from "@/lib/upload-validation";

export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB; insurance COIs run large.
const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isValidKind(k: string): k is SupplierDocKind {
  return (SUPPLIER_DOC_KINDS as readonly string[]).includes(k);
}

/**
 * Lists all documents the active supplier has on file. Used by the dashboard
 * to populate the 4 doc slots with current state.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getActiveSupplierContext(user);
  if (!ctx) {
    return NextResponse.json({ error: "No active supplier." }, { status: 403 });
  }
  const docs = await prisma.supplierDocument.findMany({
    where: { supplierId: ctx.supplier.id },
    orderBy: [{ uploadedAt: "desc" }],
  });
  return NextResponse.json({ ok: true, documents: docs });
}

/**
 * Upload a new legal document. PLH-1 commit 3: file uploads only (the
 * URL-paste fallback was a privacy risk: there was no proof the supplier
 * actually controlled the URL, and any URL pasted into the field became a
 * "verified" document slot). Blob is now uploaded with access:"private";
 * download routes stream the bytes back behind a role check + audit log.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getActiveSupplierContext(user);
  if (!ctx) {
    return NextResponse.json({ error: "No active supplier." }, { status: 403 });
  }
  if (!canManageDocuments(ctx.role) && !ctx.actingAsAdmin) {
    return NextResponse.json(
      {
        error:
          "Only the supplier owner or an admin can upload legal documents.",
      },
      { status: 403 }
    );
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "File uploads are not configured. Ask an admin to add a Vercel Blob store (BLOB_READ_WRITE_TOKEN auto-populates).",
      },
      { status: 503 }
    );
  }
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: "Invalid upload payload." },
      { status: 400 }
    );
  }
  const kind = String(form.get("kind") || "").toUpperCase();
  if (!isValidKind(kind)) {
    return NextResponse.json(
      { error: "Unknown document kind." },
      { status: 400 }
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file attached." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `Document is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 12 MB.`,
      },
      { status: 400 }
    );
  }
  // PLH-1 commit 3: magic-byte sniff. The client-supplied file.type is
  // ignored; we trust the actual bytes. Rejecting null catches both
  // "unknown format" and "renamed .exe with image/png label".
  const detected = await detectMagic(file);
  if (!detected || !ALLOWED.has(detected)) {
    return NextResponse.json(
      { error: "Use PDF, JPG, PNG, or WEBP." },
      { status: 400 }
    );
  }
  const ext = safeExt(file.name);
  const blob = await put(
    `supplier-docs/${ctx.supplier.id}/${kind}.${ext}`,
    file,
    { access: "private", addRandomSuffix: true, contentType: detected }
  );
  const doc = await prisma.supplierDocument.create({
    data: {
      supplierId: ctx.supplier.id,
      kind,
      filename: file.name || `${kind}.${ext}`,
      url: blob.url,
      status: "PENDING",
    },
  });
  return NextResponse.json({ ok: true, document: doc });
}

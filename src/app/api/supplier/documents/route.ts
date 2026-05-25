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

export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB; insurance COIs run large.
const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function isValidKind(k: string): k is SupplierDocKind {
  return (SUPPLIER_DOC_KINDS as readonly string[]).includes(k);
}

function safeExt(filename: string, fallback = "pdf"): string {
  const ext = filename.split(".").pop()?.toLowerCase() || fallback;
  // Keep it short so a malicious filename can't blow up the blob key.
  return ext.replace(/[^a-z0-9]/g, "").slice(0, 6) || fallback;
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
 * Upload a new legal document. Two paths, matching the tax-exempt cert route:
 *   - multipart/form-data with `file` + `kind`: uploaded to Vercel Blob.
 *   - application/json with `{ kind, url, filename? }`: URL-paste fallback for
 *     when Blob isn't configured or the supplier already hosts the file.
 * Either way: new row created in PENDING status. Admin reviews from /admin.
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

  const contentType = req.headers.get("content-type") || "";

  // ---- URL-paste fallback (JSON) ----------------------------------------
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind || "").toUpperCase();
    const url = String(body.url || "").trim();
    const filename =
      String(body.filename || "").trim() || url.split("/").pop() || "document";
    if (!isValidKind(kind)) {
      return NextResponse.json(
        { error: "Unknown document kind." },
        { status: 400 }
      );
    }
    if (!url) {
      return NextResponse.json(
        { error: "Provide a document URL." },
        { status: 400 }
      );
    }
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json(
        { error: "URL must start with https:// or http://." },
        { status: 400 }
      );
    }
    const doc = await prisma.supplierDocument.create({
      data: {
        supplierId: ctx.supplier.id,
        kind,
        filename,
        url,
        status: "PENDING",
      },
    });
    return NextResponse.json({ ok: true, document: doc });
  }

  // ---- File upload via Vercel Blob -------------------------------------
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "File uploads are not configured. Either ask an admin to add a Vercel Blob store (BLOB_READ_WRITE_TOKEN auto-populates), or paste a hosted document URL instead.",
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
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "Use PDF, JPG, PNG, or WEBP." },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `Document is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 12 MB.`,
      },
      { status: 400 }
    );
  }
  const ext = safeExt(file.name);
  const blob = await put(
    `supplier-docs/${ctx.supplier.id}/${kind}.${ext}`,
    file,
    { access: "public", addRandomSuffix: true, contentType: file.type }
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

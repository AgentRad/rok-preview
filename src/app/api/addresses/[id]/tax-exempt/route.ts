import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

/**
 * Buyers upload a resale or government-entity certificate against a saved
 * address. Two paths:
 *   - multipart/form-data with a `file` part: uploaded to Vercel Blob (when
 *     BLOB_READ_WRITE_TOKEN is set).
 *   - application/json with `{ url }`: skips Blob and just records the
 *     hosted URL on the address (useful when Blob isn't configured, or for
 *     buyers who already host their cert in their own DMS).
 * Either way, status flips to PENDING. Admin reviews and sets APPROVED /
 * REJECTED via the PATCH below.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const { id } = await params;
  const address = await prisma.address.findFirst({
    where: { id, userId: user.id },
  });
  if (!address) {
    return NextResponse.json({ error: "Address not found." }, { status: 404 });
  }

  const contentType = req.headers.get("content-type") || "";

  // ---- URL-paste fallback (JSON) ----------------------------------------
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    const url = String(body.url || "").trim();
    if (!url) {
      return NextResponse.json(
        { error: "Provide a certificate URL." },
        { status: 400 }
      );
    }
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json(
        { error: "URL must start with https:// or http://." },
        { status: 400 }
      );
    }
    await prisma.address.update({
      where: { id },
      data: {
        taxExemptCertificateUrl: url,
        taxExemptStatus: "PENDING",
      },
    });
    return NextResponse.json({ ok: true, url, status: "PENDING" });
  }

  // ---- File upload via Vercel Blob -------------------------------------
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "File uploads are not configured. Either add a Vercel Blob store (BLOB_READ_WRITE_TOKEN auto-populates) or paste a hosted certificate URL instead.",
      },
      { status: 503 }
    );
  }
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Invalid upload payload." }, { status: 400 });
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
        error: `Certificate is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 8 MB.`,
      },
      { status: 400 }
    );
  }
  const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
  const blob = await put(
    `tax-exempt/${user.id}/${id}.${ext}`,
    file,
    { access: "public", addRandomSuffix: true, contentType: file.type }
  );
  await prisma.address.update({
    where: { id },
    data: {
      taxExemptCertificateUrl: blob.url,
      taxExemptStatus: "PENDING",
    },
  });
  return NextResponse.json({
    ok: true,
    url: blob.url,
    status: "PENDING",
  });
}

/**
 * Admin sets the cert status. Buyer can also call DELETE to clear their own
 * cert (returns the address to no-cert state).
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
  const updated = await prisma.address.update({
    where: { id },
    data: { taxExemptStatus: status },
  });
  return NextResponse.json({ ok: true, address: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const { id } = await params;
  const address = await prisma.address.findFirst({
    where: { id, userId: user.id },
  });
  if (!address) {
    return NextResponse.json({ error: "Address not found." }, { status: 404 });
  }
  await prisma.address.update({
    where: { id },
    data: { taxExemptCertificateUrl: null, taxExemptStatus: null },
  });
  return NextResponse.json({ ok: true });
}

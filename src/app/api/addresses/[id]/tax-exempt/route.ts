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
 * address. The certificate goes into Vercel Blob, the URL onto the Address,
 * status flips to PENDING. An admin reviews and sets APPROVED / REJECTED.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "File uploads are not configured. Add a Vercel Blob store and BLOB_READ_WRITE_TOKEN will auto-populate.",
      },
      { status: 503 }
    );
  }
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

import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getActiveSupplierContext, canManageTeam } from "@/lib/supplier-access";

export const runtime = "nodejs";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "File uploads are not configured yet. Add a Vercel Blob store to the project (Storage > Create > Blob) and the BLOB_READ_WRITE_TOKEN will auto-populate. Until then, paste a logo URL in your profile.",
      },
      { status: 503 }
    );
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const ctx = await getActiveSupplierContext(user);
  if (!ctx) {
    return NextResponse.json({ error: "No active supplier." }, { status: 403 });
  }
  if (!canManageTeam(ctx.role) && !ctx.actingAsAdmin) {
    return NextResponse.json(
      { error: "Only the supplier owner or an admin can upload a logo." },
      { status: 403 }
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
      { error: "Use JPG, PNG, or WEBP." },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Logo is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 2 MB.` },
      { status: 400 }
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const blob = await put(
    `suppliers/${ctx.supplier.id}/logo.${ext}`,
    file,
    { access: "public", addRandomSuffix: true, contentType: file.type }
  );
  await prisma.supplier.update({
    where: { id: ctx.supplier.id },
    data: { logoUrl: blob.url },
  });
  return NextResponse.json({ ok: true, logoUrl: blob.url });
}

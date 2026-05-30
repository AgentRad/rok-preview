import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set([
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

/**
 * Upload a buyer's company logo. Same Vercel Blob pattern as the supplier
 * and OEM logo uploads. Snapshots the URL onto User.companyLogoUrl; the
 * next time the buyer places an order we snapshot it onto the Order so
 * old invoices keep their original branding.
 *
 * Gracefully returns 503 if Vercel Blob isn't configured; the UI falls
 * back to a paste-URL field.
 */
export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "File uploads aren't enabled on this deployment. Paste a hosted logo URL on your profile instead.",
      },
      { status: 503 }
    );
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
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
      { error: "Use SVG (best), PNG, JPG, or WEBP." },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Logo is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 2 MB.` },
      { status: 400 }
    );
  }
  if (file.size < 200) {
    return NextResponse.json(
      {
        error:
          "File is unusually small (under 200 bytes). Export a real logo, not a placeholder.",
      },
      { status: 400 }
    );
  }
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const blob = await put(
    `buyers/${user.id}/company-logo.${ext}`,
    file,
    { access: "public", addRandomSuffix: true, contentType: file.type }
  );
  await prisma.user.update({
    where: { id: user.id },
    data: { companyLogoUrl: blob.url },
  });
  return NextResponse.json({ ok: true, logoUrl: blob.url });
}

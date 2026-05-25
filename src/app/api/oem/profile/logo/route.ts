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

export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "File uploads are not configured. Paste a hosted logo URL on the profile form instead.",
      },
      { status: 503 }
    );
  }
  const user = await getCurrentUser();
  if (!user || user.role !== "MANUFACTURER") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
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
      { error: "File is empty or corrupted." },
      { status: 400 }
    );
  }
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const blob = await put(
    `oems/${user.id}/logo.${ext}`,
    file,
    { access: "public", addRandomSuffix: true, contentType: file.type }
  );
  await prisma.user.update({
    where: { id: user.id },
    data: { manufacturerLogoUrl: blob.url },
  });
  return NextResponse.json({ ok: true, logoUrl: blob.url });
}

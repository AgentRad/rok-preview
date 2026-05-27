import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { detectMagic, safeExt } from "@/lib/upload-validation";

export const runtime = "nodejs";

const MAX_BYTES = 2 * 1024 * 1024;
// PLH-2 Phase 4c (C2): SVG removed. SVG can execute embedded scripts when
// rendered inline on the public storefront, so a malicious OEM could ship
// XSS in their own logo. Raster only. Mirrors the PLH-1 supplier-logo call.
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
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
  // PLH-2 Phase 4c (C3): rate-limit OEM logo uploads.
  const rl = await rateLimit("generic", `oem:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
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
  // PLH-2 Phase 4c (C1): magic-byte sniff. file.type can lie; the actual
  // bytes are what we trust + persist as the blob contentType.
  const detected = await detectMagic(file);
  if (!detected || !ALLOWED.has(detected)) {
    return NextResponse.json(
      { error: "Use PNG, JPG, or WEBP." },
      { status: 400 }
    );
  }
  const ext = safeExt(file.name, "png");
  // PLH-3c F8: random per-upload suffix in the blob path so the public
  // logo URL doesn't leak the OEM's User id. Previous path was
  // `oems/${user.id}/logo.${ext}`.
  const pathSuffix = crypto.randomBytes(8).toString("hex");
  const blob = await put(
    `oems/${user.id}_${pathSuffix}/logo.${ext}`,
    file,
    { access: "public", addRandomSuffix: true, contentType: detected }
  );
  await prisma.user.update({
    where: { id: user.id },
    data: { manufacturerLogoUrl: blob.url },
  });
  return NextResponse.json({ ok: true, logoUrl: blob.url });
}

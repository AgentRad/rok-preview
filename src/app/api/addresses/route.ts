import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { validateAddress } from "@/lib/address";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const addresses = await prisma.address.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ addresses });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  // PLH-2 Phase 4d (D2): per-user throttle on address mutations.
  const rl = await rateLimit("generic", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }
  const body = await req.json().catch(() => ({}));
  const err = validateAddress(body);
  if (err) {
    if (typeof err === "string") {
      return NextResponse.json({ error: err }, { status: 400 });
    }
    return NextResponse.json({ error: err.error, field: err.field }, { status: 400 });
  }

  const setDefault = Boolean(body.isDefault);
  const created = await prisma.$transaction(async (tx) => {
    if (setDefault) {
      await tx.address.updateMany({
        where: { userId: user.id, isDefault: true },
        data: { isDefault: false },
      });
    }
    const existingCount = await tx.address.count({ where: { userId: user.id } });
    return tx.address.create({
      data: {
        userId: user.id,
        label: String(body.label || "").trim(),
        recipient: String(body.recipient).trim(),
        company: String(body.company || "").trim(),
        line1: String(body.line1).trim(),
        line2: String(body.line2 || "").trim(),
        city: String(body.city).trim(),
        region: String(body.region).trim(),
        postalCode: String(body.postalCode).trim().toUpperCase(),
        country: String(body.country || "US").trim().toUpperCase(),
        phone: String(body.phone || "").trim(),
        isDefault: setDefault || existingCount === 0,
      },
    });
  });

  return NextResponse.json({ ok: true, address: created });
}

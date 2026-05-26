import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function POST(req: Request) {
  // PLH-1 commit 4: throttle the public supplier-application form. Cheap
  // protection against bot floods filling the admin queue with junk apps.
  const rl = await rateLimit("register", clientIp(req));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many applications from this address. Try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }
  const b = await req.json().catch(() => ({}));
  const companyName = String(b.companyName || "").trim();
  const contactName = String(b.contactName || "").trim();
  const email = String(b.email || "").toLowerCase().trim();
  if (!companyName || !contactName || !email) {
    return NextResponse.json(
      { error: "Company, contact name and email are required." },
      { status: 400 }
    );
  }
  // PLH-1 commit 4: soft idempotency. A double-submit (or a buyer who
  // already applied yesterday) returns the existing PENDING application
  // id with a 200 instead of creating a duplicate row the admin then has
  // to triage. 24h window is wide enough to swallow accidental retries
  // without silently swallowing a legitimately resent application weeks
  // later.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await prisma.supplierApplication.findFirst({
    where: {
      email,
      companyName,
      status: "PENDING",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ ok: true, id: existing.id, idempotent: true });
  }
  const created = await prisma.supplierApplication.create({
    data: {
      companyName,
      contactName,
      email,
      website: String(b.website || "").trim(),
      category: String(b.category || "Other / multiple"),
      yearsTrading: String(b.yearsTrading || "Not specified"),
      certs: String(b.certs || "").trim(),
      message: String(b.message || "").trim(),
      status: "PENDING",
    },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: created.id });
}

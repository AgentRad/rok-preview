import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

const NAME_CAP = 256;

/**
 * PLH-3y-1: admin-only buyer org creation. No self-serve creation this round.
 */
export async function POST(req: Request) {
  const admin = await getCurrentUser();
  if (!admin || admin.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const rl = await rateLimit("generic", `user:${admin.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, NAME_CAP);
  if (!name) {
    return NextResponse.json({ error: "An organization name is required." }, { status: 400 });
  }

  const org = await prisma.buyerOrg.create({
    data: { name, createdByUserId: admin.id },
  });

  await writeAuditLog({
    actor: admin,
    action: "BUYER_ORG_CREATED",
    targetType: "BuyerOrg",
    targetId: org.id,
    summary: `Created buyer org ${name}`,
  });

  return NextResponse.json({ ok: true, id: org.id });
}

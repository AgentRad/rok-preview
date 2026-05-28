import { NextResponse } from "next/server";
import type { BuyerOrgRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

const VALID_ROLES: BuyerOrgRole[] = ["ADMIN", "APPROVER", "BUYER", "VIEWER"];

function parseRole(input: unknown): BuyerOrgRole {
  if (typeof input !== "string") return "BUYER";
  const upper = input.toUpperCase() as BuyerOrgRole;
  return VALID_ROLES.includes(upper) ? upper : "BUYER";
}

/**
 * PLH-3y-1: admin adds an EXISTING user to a buyer org by email. New emails
 * (no account yet) go through the invite flow, not this route.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getCurrentUser();
  if (!admin || admin.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const rl = await rateLimit("generic", `user:${admin.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { id: buyerOrgId } = await params;
  const org = await prisma.buyerOrg.findUnique({ where: { id: buyerOrgId } });
  if (!org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").toLowerCase().trim();
  const role = parseRole(body.role);
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json(
      { error: "No account exists for that email. Send an invite instead." },
      { status: 404 }
    );
  }

  const already = await prisma.buyerOrgMember.findUnique({
    where: { buyerOrgId_userId: { buyerOrgId, userId: user.id } },
  });
  if (already) {
    return NextResponse.json(
      { error: "This user is already a member of the organization." },
      { status: 400 }
    );
  }

  const member = await prisma.buyerOrgMember.create({
    data: { buyerOrgId, userId: user.id, role, addedByUserId: admin.id },
  });

  await writeAuditLog({
    actor: admin,
    action: "BUYER_ORG_MEMBER_ADDED",
    targetType: "BuyerOrg",
    targetId: buyerOrgId,
    summary: `Added ${email} as ${role} to ${org.name}`,
    metadata: { userId: user.id, role },
  });

  return NextResponse.json({ ok: true, memberId: member.id });
}

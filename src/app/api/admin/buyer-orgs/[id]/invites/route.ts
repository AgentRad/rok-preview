import { NextResponse, after } from "next/server";
import crypto from "node:crypto";
import type { BuyerOrgRole } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { sendBuyerOrgInvite } from "@/lib/email";
import { siteUrl } from "@/lib/site-url";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

const INVITE_DAYS = 14;
const VALID_ROLES: BuyerOrgRole[] = ["ADMIN", "APPROVER", "BUYER", "VIEWER"];

function parseRole(input: unknown): BuyerOrgRole {
  if (typeof input !== "string") return "BUYER";
  const upper = input.toUpperCase() as BuyerOrgRole;
  return VALID_ROLES.includes(upper) ? upper : "BUYER";
}

/**
 * PLH-3y-1: admin invites a new email to a buyer org. Mirrors the supplier
 * team invite pattern: a hashed token is stored, the raw token rides in the
 * accept URL. The partial unique index keeps one pending invite per email +
 * org.
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

  // Already a member?
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const already = await prisma.buyerOrgMember.findUnique({
      where: { buyerOrgId_userId: { buyerOrgId, userId: existingUser.id } },
    });
    if (already) {
      return NextResponse.json(
        { error: "This user is already a member of the organization." },
        { status: 400 }
      );
    }
  }

  const raw = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);

  try {
    await prisma.buyerOrgInvite.create({
      data: { buyerOrgId, email, role, tokenHash, invitedByUserId: admin.id, expiresAt },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "A pending invite already exists for that email." },
        { status: 400 }
      );
    }
    throw err;
  }

  await writeAuditLog({
    actor: admin,
    action: "BUYER_ORG_INVITE_SENT",
    targetType: "BuyerOrg",
    targetId: buyerOrgId,
    summary: `Invited ${email} as ${role} to ${org.name}`,
    metadata: { role },
  });

  const acceptUrl = siteUrl(`/buyer-org-invite/${raw}`);
  after(async () => {
    try {
      await sendBuyerOrgInvite({
        to: email,
        inviterName: admin.name,
        orgName: org.name,
        acceptUrl,
        expiresDays: INVITE_DAYS,
      });
    } catch (err) {
      captureError(err, { subsystem: "email", op: "buyer-org-invite", email });
    }
  });

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import {
  getActiveBuyerOrgContext,
  canManageBuyerOrg,
} from "@/lib/buyer-org-access";
import { isFreeEmailDomain, normalizeDomainClaim } from "@/lib/free-email-domains";

export const runtime = "nodejs";

/**
 * PLH-3y-3: org email domains.
 *
 * GET  returns the active org's claimed domains (any member may read so the
 *      org-home page can render verification status). The TXT record value is
 *      included so an admin can copy it.
 * POST claims a domain. ADMIN-only. Rejects free-email providers. Mints a
 *      verificationToken; the admin adds it as a DNS TXT record and the cron
 *      verifies it. Status starts PENDING; autoJoinEnabled starts false.
 */

function txtRecordValue(token: string): string {
  return `partsport-verify=${token}`;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx) return NextResponse.json({ domains: [] });

  const domains = await prisma.buyerOrgDomain.findMany({
    where: { buyerOrgId: ctx.org.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    canManage: canManageBuyerOrg(ctx.role),
    domains: domains.map((d) => ({
      id: d.id,
      domain: d.domain,
      status: d.status,
      verifiedAt: d.verifiedAt ? d.verifiedAt.toISOString() : null,
      txtLastCheckedAt: d.txtLastCheckedAt
        ? d.txtLastCheckedAt.toISOString()
        : null,
      txtRecordName: `_partsport.${d.domain}`,
      txtRecordValue: txtRecordValue(d.verificationToken),
      autoJoinEnabled: d.autoJoinEnabled,
      autoJoinRole: d.autoJoinRole,
    })),
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx || !canManageBuyerOrg(ctx.role)) {
    return NextResponse.json(
      { error: "Only an organization admin can claim domains." },
      { status: 403 }
    );
  }
  const rl = await rateLimit("generic", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const domain = normalizeDomainClaim(String(body.domain || ""));
  if (!domain) {
    return NextResponse.json(
      { error: "Enter a valid domain, e.g. acme.com." },
      { status: 400 }
    );
  }
  if (isFreeEmailDomain(domain)) {
    return NextResponse.json(
      {
        error:
          "Public email providers (gmail.com, outlook.com, etc.) cannot be claimed.",
      },
      { status: 400 }
    );
  }

  // Domain is globally unique. If it is already claimed (by this org or
  // another), reject rather than leak which org holds it.
  const existing = await prisma.buyerOrgDomain.findUnique({ where: { domain } });
  if (existing) {
    return NextResponse.json(
      { error: "That domain is already claimed." },
      { status: 409 }
    );
  }

  const verificationToken = crypto.randomBytes(16).toString("hex");
  const created = await prisma.buyerOrgDomain.create({
    data: {
      buyerOrgId: ctx.org.id,
      domain,
      verificationToken,
      status: "PENDING",
      createdByUserId: user.id,
    },
  });

  await writeAuditLog({
    actor: user,
    action: "BUYER_ORG_DOMAIN_CLAIMED",
    targetType: "BuyerOrg",
    targetId: ctx.org.id,
    summary: `Claimed domain ${domain} for ${ctx.org.name}`,
    metadata: { domainId: created.id, domain },
  });

  return NextResponse.json({
    ok: true,
    id: created.id,
    domain,
    status: "PENDING",
    txtRecordName: `_partsport.${domain}`,
    txtRecordValue: txtRecordValue(verificationToken),
    autoJoinEnabled: false,
    autoJoinRole: created.autoJoinRole,
  });
}

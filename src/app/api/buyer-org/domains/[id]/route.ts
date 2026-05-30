import { NextResponse } from "next/server";
import type { BuyerOrgRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import {
  getActiveBuyerOrgContext,
  canManageBuyerOrg,
} from "@/lib/buyer-org-access";

export const runtime = "nodejs";

const AUTOJOIN_ROLES: BuyerOrgRole[] = ["VIEWER", "BUYER", "APPROVER"];

/**
 * PLH-3y-3: manage a claimed domain. ADMIN-only.
 *
 * PATCH toggles autoJoinEnabled and sets autoJoinRole. Auto-join can only be
 *       turned on once the domain is VERIFIED (LOCKED DECISION). ADMIN is not
 *       offered as an auto-join role (auto-joiners should never land as org
 *       admins); the choices are VIEWER (default), BUYER, or APPROVER.
 * DELETE removes the claim entirely.
 */
async function loadAdminContext(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx || !canManageBuyerOrg(ctx.role)) return null;
  return ctx;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await loadAdminContext(user);
  if (!ctx) {
    return NextResponse.json(
      { error: "Only an organization admin can manage domains." },
      { status: 403 }
    );
  }
  const rl = await rateLimit("generic", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { id } = await params;
  const domain = await prisma.buyerOrgDomain.findFirst({
    where: { id, buyerOrgId: ctx.org.id },
  });
  if (!domain) {
    return NextResponse.json({ error: "Domain not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const enabled = Boolean(body.autoJoinEnabled);
  let role: BuyerOrgRole = domain.autoJoinRole;
  if (body.autoJoinRole !== undefined) {
    const requested = String(body.autoJoinRole).toUpperCase() as BuyerOrgRole;
    if (!AUTOJOIN_ROLES.includes(requested)) {
      return NextResponse.json(
        { error: "Auto-join role must be VIEWER, BUYER, or APPROVER." },
        { status: 400 }
      );
    }
    role = requested;
  }

  if (enabled && domain.status !== "VERIFIED") {
    return NextResponse.json(
      { error: "Verify the domain before enabling auto-join." },
      { status: 409 }
    );
  }

  await prisma.buyerOrgDomain.update({
    where: { id: domain.id },
    data: { autoJoinEnabled: enabled, autoJoinRole: role },
  });

  await writeAuditLog({
    actor: user,
    action: "BUYER_ORG_DOMAIN_AUTOJOIN_UPDATED",
    targetType: "BuyerOrg",
    targetId: ctx.org.id,
    summary: `Auto-join for ${domain.domain} set to ${enabled ? `on (${role})` : "off"}`,
    metadata: { domainId: domain.id, autoJoinEnabled: enabled, autoJoinRole: role },
  });

  return NextResponse.json({ ok: true, autoJoinEnabled: enabled, autoJoinRole: role });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await loadAdminContext(user);
  if (!ctx) {
    return NextResponse.json(
      { error: "Only an organization admin can manage domains." },
      { status: 403 }
    );
  }
  const rl = await rateLimit("generic", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { id } = await params;
  const domain = await prisma.buyerOrgDomain.findFirst({
    where: { id, buyerOrgId: ctx.org.id },
  });
  if (!domain) {
    return NextResponse.json({ error: "Domain not found." }, { status: 404 });
  }
  await prisma.buyerOrgDomain.delete({ where: { id: domain.id } });

  await writeAuditLog({
    actor: user,
    action: "BUYER_ORG_DOMAIN_REMOVED",
    targetType: "BuyerOrg",
    targetId: ctx.org.id,
    summary: `Removed domain ${domain.domain} from ${ctx.org.name}`,
    metadata: { domainId: domain.id, domain: domain.domain },
  });

  return NextResponse.json({ ok: true });
}

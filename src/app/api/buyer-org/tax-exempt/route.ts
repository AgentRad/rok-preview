import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import {
  getActiveBuyerOrgContext,
  canManageBuyerOrg,
} from "@/lib/buyer-org-access";

export const runtime = "nodejs";

/**
 * PLH-3y-2: org-level tax-exempt cert. An org ADMIN records the org's resale
 * or government-entity certificate (URL-paste). Status flips to PENDING; a
 * site admin approves it from the admin console. Once APPROVED + not expired
 * it waives tax for every member's orders (see lib/stripe-tax.ts). Mirrors the
 * per-Address cert flow from PLH-3j P4.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx || !canManageBuyerOrg(ctx.role)) {
    return NextResponse.json(
      { error: "Only an organization admin can manage the org tax-exempt cert." },
      { status: 403 }
    );
  }
  const rl = await rateLimit("generic", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const url = String(body.url || "").trim();
  if (!url) {
    return NextResponse.json(
      { error: "Provide a certificate URL." },
      { status: 400 }
    );
  }
  if (!/^https:\/\//i.test(url)) {
    return NextResponse.json(
      { error: "Certificate URL must start with https://." },
      { status: 400 }
    );
  }
  let expiresAt: Date | null = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "") {
    const d = new Date(String(body.expiresAt));
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(
        { error: "expiresAt must be an ISO date." },
        { status: 400 }
      );
    }
    expiresAt = d;
  }

  await prisma.buyerOrg.update({
    where: { id: ctx.org.id },
    data: {
      taxExemptCertificateUrl: url,
      taxExemptStatus: "PENDING",
      taxExemptExpiresAt: expiresAt,
    },
  });

  await writeAuditLog({
    actor: user,
    action: "BUYER_ORG_TAX_EXEMPT_UPDATED",
    targetType: "BuyerOrg",
    targetId: ctx.org.id,
    summary: `Set org tax-exempt cert (PENDING) for ${ctx.org.name}`,
    metadata: { status: "PENDING" },
  });

  return NextResponse.json({ ok: true, status: "PENDING" });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx || !canManageBuyerOrg(ctx.role)) {
    return NextResponse.json(
      { error: "Only an organization admin can manage the org tax-exempt cert." },
      { status: 403 }
    );
  }
  await prisma.buyerOrg.update({
    where: { id: ctx.org.id },
    data: {
      taxExemptCertificateUrl: null,
      taxExemptStatus: null,
      taxExemptExpiresAt: null,
    },
  });
  await writeAuditLog({
    actor: user,
    action: "BUYER_ORG_TAX_EXEMPT_UPDATED",
    targetType: "BuyerOrg",
    targetId: ctx.org.id,
    summary: `Cleared org tax-exempt cert for ${ctx.org.name}`,
    metadata: { status: "CLEARED" },
  });
  return NextResponse.json({ ok: true });
}

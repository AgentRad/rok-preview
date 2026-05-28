import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import {
  getActiveBuyerOrgContext,
  canManageBuyerOrg,
} from "@/lib/buyer-org-access";
import { validateAddress, ADDRESS_FIELD_CAPS } from "@/lib/address";

export const runtime = "nodejs";

/**
 * PLH-3y-2: shared org address book.
 *
 * GET  returns the active org's (non-deleted) shared addresses. Any member
 *      can read them so they surface as selectable ship-to at checkout.
 * POST adds a shared address. ADMIN-only (canManageBuyerOrg).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getActiveBuyerOrgContext(user);
  if (!ctx) return NextResponse.json({ addresses: [] });
  const addresses = await prisma.buyerOrgAddress.findMany({
    where: { buyerOrgId: ctx.org.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    orgName: ctx.org.name,
    canManage: canManageBuyerOrg(ctx.role),
    addresses: addresses.map((a) => ({
      id: a.id,
      label: a.label,
      recipient: a.recipient,
      company: a.company,
      line1: a.line1,
      line2: a.line2,
      city: a.city,
      region: a.region,
      postalCode: a.postalCode,
      country: a.country,
      phone: a.phone,
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
      { error: "Only an organization admin can manage shared addresses." },
      { status: 403 }
    );
  }
  const rl = await rateLimit("generic", `user:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const input = {
    label: String(body.label || "").trim(),
    recipient: String(body.recipient || "").trim(),
    company: String(body.company || "").trim(),
    line1: String(body.line1 || "").trim(),
    line2: String(body.line2 || "").trim(),
    city: String(body.city || "").trim(),
    region: String(body.region || "").trim(),
    postalCode: String(body.postalCode || "").trim(),
    country: (String(body.country || "US").trim() || "US").toUpperCase(),
    phone: String(body.phone || "").trim(),
  };
  const err = validateAddress(input);
  if (err) {
    if (typeof err === "string") {
      return NextResponse.json({ error: err }, { status: 400 });
    }
    return NextResponse.json({ field: err.field, error: err.error }, { status: 400 });
  }
  if (input.label.length > ADDRESS_FIELD_CAPS.label) {
    return NextResponse.json(
      { field: "label", error: "Label is too long." },
      { status: 400 }
    );
  }

  const created = await prisma.buyerOrgAddress.create({
    data: {
      buyerOrgId: ctx.org.id,
      label: input.label,
      recipient: input.recipient,
      company: input.company,
      line1: input.line1,
      line2: input.line2,
      city: input.city,
      region: input.region,
      postalCode: input.postalCode,
      country: input.country,
      phone: input.phone,
      addedByUserId: user.id,
    },
  });

  await writeAuditLog({
    actor: user,
    action: "BUYER_ORG_ADDRESS_ADDED",
    targetType: "BuyerOrg",
    targetId: ctx.org.id,
    summary: `Added shared address ${input.label || input.recipient} to ${ctx.org.name}`,
    metadata: { addressId: created.id },
  });

  return NextResponse.json({ ok: true, id: created.id });
}

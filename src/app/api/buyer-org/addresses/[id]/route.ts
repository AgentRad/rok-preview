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
 * PLH-3y-2: soft-delete a shared org address. ADMIN-only. The row is flipped
 * to deletedAt so any historical Order ship-to denorm stays intact.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  // Scope to the active org so an admin of one org can't delete another's row.
  const addr = await prisma.buyerOrgAddress.findFirst({
    where: { id, buyerOrgId: ctx.org.id, deletedAt: null },
  });
  if (!addr) {
    return NextResponse.json({ error: "Address not found." }, { status: 404 });
  }
  await prisma.buyerOrgAddress.update({
    where: { id: addr.id },
    data: { deletedAt: new Date() },
  });

  await writeAuditLog({
    actor: user,
    action: "BUYER_ORG_ADDRESS_REMOVED",
    targetType: "BuyerOrg",
    targetId: ctx.org.id,
    summary: `Removed shared address ${addr.label || addr.recipient} from ${ctx.org.name}`,
    metadata: { addressId: addr.id },
  });

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * PLH-3y-2: site admin sets the status of an org's tax-exempt cert. Only an
 * APPROVED + not-expired cert waives tax for the org's members.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const status = String(body.status || "").toUpperCase();
  if (status !== "APPROVED" && status !== "REJECTED" && status !== "PENDING") {
    return NextResponse.json(
      { error: "status must be APPROVED, REJECTED, or PENDING." },
      { status: 400 }
    );
  }
  const org = await prisma.buyerOrg.findUnique({ where: { id } });
  if (!org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }
  await prisma.buyerOrg.update({
    where: { id },
    data: { taxExemptStatus: status },
  });
  await writeAuditLog({
    actor: user,
    action: "BUYER_ORG_TAX_EXEMPT_UPDATED",
    targetType: "BuyerOrg",
    targetId: id,
    summary: `Org tax-exempt cert ${status} for ${org.name}`,
    metadata: { status },
  });
  return NextResponse.json({ ok: true, status });
}

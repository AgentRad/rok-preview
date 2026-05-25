import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog, type AuditAction } from "@/lib/audit";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const status = body.status ? String(body.status).trim().toUpperCase() : "";

  if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
    return NextResponse.json(
      { error: "Invalid status. Must be APPROVED, REJECTED, or PENDING." },
      { status: 400 }
    );
  }

  const address = await prisma.address.findUnique({
    where: { id },
  });

  if (!address) {
    return NextResponse.json(
      { error: "Address not found." },
      { status: 404 }
    );
  }

  const updated = await prisma.address.update({
    where: { id },
    data: { taxExemptStatus: status },
  });

  const action: AuditAction =
    status === "APPROVED"
      ? "TAX_EXEMPT_APPROVED"
      : status === "REJECTED"
        ? "TAX_EXEMPT_REJECTED"
        : "TAX_EXEMPT_PENDING";
  await writeAuditLog({
    actor: user,
    action,
    targetType: "Address",
    targetId: updated.id,
    summary: `Tax-exempt cert ${address.taxExemptStatus || "PENDING"} -> ${status}`,
    metadata: {
      buyerId: address.userId,
      city: address.city,
      region: address.region,
    },
  });

  return NextResponse.json({ ok: true, address: updated });
}

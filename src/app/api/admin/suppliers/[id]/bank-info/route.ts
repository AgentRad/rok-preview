import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

const VALID_STATUSES = new Set([
  "MISSING",
  "PENDING",
  "ON_FILE",
  "REJECTED",
]);

/**
 * Admin marks a supplier's bank info status (typically ON_FILE once the
 * encrypted ACH details have been received out of band). Optional note
 * records when/how it was confirmed so the audit trail makes sense to
 * the next admin.
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
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json(
      {
        error:
          "status must be MISSING, PENDING, ON_FILE, or REJECTED.",
      },
      { status: 400 }
    );
  }
  const note =
    typeof body.note === "string"
      ? body.note.trim().slice(0, 500)
      : undefined;

  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) {
    return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
  }
  const updated = await prisma.supplier.update({
    where: { id },
    data: {
      bankInfoStatus: status,
      bankInfoUpdatedAt: new Date(),
      ...(note !== undefined ? { bankInfoNote: note } : {}),
    },
  });
  await writeAuditLog({
    actor: user,
    action: "SUPPLIER_BANK_INFO_UPDATED",
    targetType: "Supplier",
    targetId: updated.id,
    summary: `${updated.name}: bank info ${supplier.bankInfoStatus} -> ${status}${note ? ` (${note})` : ""}`,
    metadata: { previousStatus: supplier.bankInfoStatus, newStatus: status },
  });
  return NextResponse.json({
    ok: true,
    supplier: {
      id: updated.id,
      bankInfoStatus: updated.bankInfoStatus,
      bankInfoLast4: updated.bankInfoLast4,
      bankInfoBankName: updated.bankInfoBankName,
      bankInfoType: updated.bankInfoType,
      bankInfoNote: updated.bankInfoNote,
      bankInfoUpdatedAt: updated.bankInfoUpdatedAt,
    },
  });
}

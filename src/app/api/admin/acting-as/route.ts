import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  setActingAsSupplier,
  clearActingAsSupplier,
  getActingAsSupplier,
} from "@/lib/acting-as";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const supplierId = String(body.supplierId || "").trim();
  if (!supplierId) {
    return NextResponse.json(
      { error: "supplierId is required." },
      { status: 400 }
    );
  }
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
  });
  if (!supplier) {
    return NextResponse.json(
      { error: "Supplier not found." },
      { status: 404 }
    );
  }
  await setActingAsSupplier(supplier.id, user.id);
  await writeAuditLog({
    actor: user,
    action: "ACCOUNT_IMPERSONATION_STARTED",
    targetType: "Supplier",
    targetId: supplier.id,
    summary: `Started acting-as ${supplier.name}`,
    metadata: { supplierName: supplier.name },
  });
  return NextResponse.json({ ok: true, supplierName: supplier.name });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const wasActingAs = await getActingAsSupplier(user.id);
  await clearActingAsSupplier();
  if (wasActingAs) {
    await writeAuditLog({
      actor: user,
      action: "ACCOUNT_IMPERSONATION_STOPPED",
      targetType: "Supplier",
      targetId: wasActingAs,
      summary: `Stopped acting-as`,
    });
  }
  return NextResponse.json({ ok: true });
}

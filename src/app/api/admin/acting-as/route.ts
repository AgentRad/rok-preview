import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  setActingAsSupplier,
  clearActingAsSupplier,
} from "@/lib/acting-as";

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
  await setActingAsSupplier(supplier.id);
  return NextResponse.json({ ok: true, supplierName: supplier.name });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  await clearActingAsSupplier();
  return NextResponse.json({ ok: true });
}

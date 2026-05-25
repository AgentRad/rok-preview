import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canManageBankInfo,
  getActiveSupplierContext,
} from "@/lib/supplier-access";

export const runtime = "nodejs";

/**
 * Supplier submits the SUMMARY of their payout method. Full account and
 * routing numbers are NEVER stored in PartsPort's database; we keep only
 * last4 + bank name + account type so the supplier can verify what's on
 * file. The supplier sends real ACH details out of band (encrypted email
 * to admin@partsport.com, or uploaded as a SupplierDocument with kind=OTHER).
 * Admin then flips bankInfoStatus to ON_FILE via the /admin route.
 */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  const ctx = await getActiveSupplierContext(user);
  if (!ctx) {
    return NextResponse.json({ error: "No active supplier." }, { status: 403 });
  }
  if (!canManageBankInfo(ctx.role) && !ctx.actingAsAdmin) {
    return NextResponse.json(
      {
        error:
          "Only the supplier owner or an admin can update bank info.",
      },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const last4Raw = String(body.last4 || "").replace(/\D/g, "");
  const bankName = String(body.bankName || "").trim().slice(0, 80);
  const type = String(body.type || "").toUpperCase();

  if (last4Raw.length !== 4) {
    return NextResponse.json(
      { error: "last4 must be exactly 4 digits." },
      { status: 400 }
    );
  }
  if (!bankName) {
    return NextResponse.json(
      { error: "Bank name is required." },
      { status: 400 }
    );
  }
  if (type !== "CHECKING" && type !== "SAVINGS") {
    return NextResponse.json(
      { error: "Account type must be CHECKING or SAVINGS." },
      { status: 400 }
    );
  }

  const updated = await prisma.supplier.update({
    where: { id: ctx.supplier.id },
    data: {
      bankInfoStatus: "PENDING",
      bankInfoLast4: last4Raw,
      bankInfoBankName: bankName,
      bankInfoType: type,
      bankInfoUpdatedAt: new Date(),
    },
  });
  return NextResponse.json({
    ok: true,
    supplier: {
      bankInfoStatus: updated.bankInfoStatus,
      bankInfoLast4: updated.bankInfoLast4,
      bankInfoBankName: updated.bankInfoBankName,
      bankInfoType: updated.bankInfoType,
      bankInfoNote: updated.bankInfoNote,
      bankInfoUpdatedAt: updated.bankInfoUpdatedAt,
    },
  });
}

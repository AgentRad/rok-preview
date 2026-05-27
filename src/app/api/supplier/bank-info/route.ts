import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canManageBankInfo,
  getActiveSupplierContext,
} from "@/lib/supplier-access";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import crypto from "node:crypto";

// PLH-3e B7: hash last-4 in audit metadata so visibility into "did it
// change?" is preserved without leaking the digits themselves through
// the audit log read surface.
function hashLast4(last4: string | null | undefined): string | null {
  if (!last4) return null;
  return crypto.createHash("sha256").update(last4).digest("hex").slice(0, 8);
}

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
  // PLH-1 commit 4: throttle bank-info edits per supplier user. Stops a
  // compromised session from rapid-firing fake updates to bury the real
  // last4 in the audit trail.
  const rl = await rateLimit("generic", `supplier:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
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

  // PLH-1 commit 4: snapshot the previous bank summary BEFORE the write
  // so the audit row carries a real before/after diff. last4 + status are
  // what an investigator needs to spot "someone changed payout destination".
  const previous = await prisma.supplier.findUnique({
    where: { id: ctx.supplier.id },
    select: { bankInfoLast4: true, bankInfoStatus: true },
  });

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

  // PLH-1 commit 4: audit + admin attention. A bank-detail change is one
  // of the highest-signal events on the platform (it's the lever for
  // payout fraud), so we write a structured audit row AND mark the
  // supplier as needing re-verification so it surfaces on the admin
  // attention feed via the PENDING bankInfoStatus.
  await writeAuditLog({
    actor: user,
    action: "SUPPLIER_BANK_INFO_UPDATED",
    targetType: "Supplier",
    targetId: updated.id,
    summary: `Bank info updated to ${bankName} ****${last4Raw} (was ****${previous?.bankInfoLast4 ?? "none"})`,
    metadata: {
      previousLast4Hash: hashLast4(previous?.bankInfoLast4 ?? null),
      newLast4Hash: hashLast4(last4Raw),
      previousStatus: previous?.bankInfoStatus ?? null,
      actor: user.id,
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

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canManageBankInfo,
  getActiveSupplierContext,
} from "@/lib/supplier-access";
import { rateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";
import { hmacLast4 } from "@/lib/route-guards";

// PLH-3e B7 / QA2 BUG 3: fingerprint last-4 in audit metadata so visibility
// into "did the payout destination change?" is preserved without leaking the
// digits. A bare sha256(last4) was brute-forceable (only 10,000 inputs), so
// this is now an HMAC keyed on a server secret: the before/after mismatch
// still signals a change, but the value is not reversible without the secret.
// Same secret-derivation pattern as order-link.ts / acting-as.ts.
function bankInfoHashSecret(): string {
  return (
    process.env.BANK_INFO_HASH_SECRET ||
    process.env.SESSION_SECRET ||
    "partsport-bank-info-hash-fallback"
  );
}
function fingerprintLast4(last4: string | null | undefined): string | null {
  return hmacLast4(last4, bankInfoHashSecret());
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
      previousLast4Hash: fingerprintLast4(previous?.bankInfoLast4 ?? null),
      newLast4Hash: fingerprintLast4(last4Raw),
      previousStatus: previous?.bankInfoStatus ?? null,
      actor: user.id,
      // QA2 BUG 1: when an admin changes the payout bank info WHILE acting-as
      // this supplier, flag it so an investigator can tell impersonated edits
      // apart from a normal supplier self-edit. The payout-destination change
      // is the exact payout-fraud lever, so the impersonation marker rides on
      // the same high-signal audit row.
      actingAsAdmin: ctx.actingAsAdmin === true,
      ...(ctx.actingAsAdmin
        ? { impersonatedSupplierId: ctx.supplier.id }
        : {}),
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

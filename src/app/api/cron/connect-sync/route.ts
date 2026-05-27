import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncSupplierConnectStatus } from "@/lib/stripe-connect";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * PLH-1 commit 4: daily reconciliation of Stripe Connect status. We
 * normally rely on the account.updated webhook to flip
 * stripePayoutsEnabled on the Supplier row, but webhooks miss
 * occasionally (lost delivery, secret rotation, dropped event). This
 * cron walks every supplier with a Connect account and re-pulls the
 * canonical state.
 *
 * Side effects on a payouts-enabled true to false transition:
 *   1. Audit row tagged SUPPLIER_CONNECT_DISABLED so an investigator
 *      can see when the flip happened.
 *   2. Attention surfaces it via the existing supplier-level attention
 *      feed by virtue of stripePayoutsEnabled being false.
 *   3. publicVisible is auto-flipped to false. A supplier who can't
 *      take payouts shouldn't be sellable; the admin can re-enable
 *      manually once Stripe is squared away.
 *
 * Schedule: vercel.json runs this at 05:00 UTC daily, well before the
 * payout retry cron at 09:45 so any newly-disabled suppliers stop
 * accruing pending transfers in the same business day.
 */

// PLH-3e B9: bounded to mirror PLH-2 Phase 4e auto-deliver / reserve-release.
// ASC by id so an oldest-first walk; hasMore in the response payload signals
// the cron should be re-fired (Vercel cron retries on hasMore, or a future
// run picks up the rest).
const MAX_PER_RUN = 200;

async function adminActor() {
  // Best-effort admin "actor" stand-in. The cron runs without a user
  // session, so we synthesize a row that won't collide with any real
  // admin. writeAuditLog uses actor.id + actor.email; both must be
  // strings. id=system keeps prior cron writes consistent.
  return { id: "system", email: "system@partsport.cron" };
}

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const suppliers = await prisma.supplier.findMany({
    where: { stripeAccountId: { not: null } },
    take: MAX_PER_RUN + 1,
    orderBy: { id: "asc" },
    select: {
      id: true,
      name: true,
      stripePayoutsEnabled: true,
      publicVisible: true,
    },
  });
  const hasMore = suppliers.length > MAX_PER_RUN;
  const batch = hasMore ? suppliers.slice(0, MAX_PER_RUN) : suppliers;

  let scanned = 0;
  let disabled = 0;
  const errors: string[] = [];
  const actor = await adminActor();

  for (const s of batch) {
    scanned++;
    try {
      const updated = await syncSupplierConnectStatus(s.id);
      if (!updated) continue;
      const wasEnabled = s.stripePayoutsEnabled;
      const nowEnabled = updated.stripePayoutsEnabled;
      if (wasEnabled && !nowEnabled) {
        disabled++;
        await writeAuditLog({
          actor,
          action: "SUPPLIER_CONNECT_DISABLED",
          targetType: "Supplier",
          targetId: s.id,
          summary: `Stripe Connect payouts disabled for ${s.name}. Stripe state changed during nightly sync.`,
          metadata: {
            supplierName: s.name,
            stripeAccountId: updated.stripeAccountId,
          },
        });
        if (s.publicVisible) {
          await prisma.supplier.update({
            where: { id: s.id },
            data: { publicVisible: false },
          });
          await writeAuditLog({
            actor,
            action: "SUPPLIER_VISIBILITY_FLIPPED",
            targetType: "Supplier",
            targetId: s.id,
            summary: `Auto-hid ${s.name} from the public catalog after Stripe Connect went disabled.`,
            metadata: { reason: "connect_disabled", previous: true, next: false },
          });
        }
      }
    } catch (err) {
      captureError(err, { subsystem: "cron", op: "connect-sync", supplierId: s.id });
      errors.push(`${s.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({ ok: true, processed: scanned, disabled, errors, hasMore });
}

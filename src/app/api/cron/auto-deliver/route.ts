import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendOrderDelivered } from "@/lib/email";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";
import { markOrderDelivered } from "@/lib/shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Nightly cron: any PAID order that has been in "Shipped" state for more
 * than AUTO_DELIVER_DAYS gets auto-flipped to Delivered. This is the
 * safety net for when carrier APIs miss a delivery event, the buyer
 * never clicks "Confirm receipt", and the admin doesn't manually mark
 * it.
 *
 * Schedule via vercel.json: { "crons": [{ "path": "/api/cron/auto-deliver",
 * "schedule": "0 9 * * *" }] } runs 09:00 UTC daily (early morning US).
 *
 * Auth: PLH-2 Phase 4e (E1). Pre-fix this route rolled its own header
 * check that fell open when CRON_SECRET was unset, including in
 * production. It now uses the shared isAuthorizedCronRequest helper
 * which fails closed in prod when the secret is missing.
 */

const AUTO_DELIVER_DAYS = 14;
const MAX_PER_RUN = 200;

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const cutoff = new Date(
    Date.now() - AUTO_DELIVER_DAYS * 24 * 60 * 60 * 1000
  );

  // E4: order by paidAt ASC so the oldest backlog gets processed first
  // when the cron is catching up after an outage.
  const candidates = await prisma.order.findMany({
    where: {
      status: "PAID",
      shipmentStage: "Shipped",
      paidAt: { lt: cutoff },
    },
    orderBy: { paidAt: "asc" },
    take: MAX_PER_RUN + 1,
    select: {
      id: true,
      reference: true,
      buyerEmail: true,
      buyerName: true,
      paidAt: true,
    },
  });

  const hasMore = candidates.length > MAX_PER_RUN;
  const batch = hasMore ? candidates.slice(0, MAX_PER_RUN) : candidates;

  let delivered = 0;
  let emailFailed = 0;
  const errors: string[] = [];

  for (const c of batch) {
    try {
      // PLH-3g P5: route through markOrderDelivered which flips every
      // slot to Delivered and recomputes the aggregate Order state +
      // stamps Order.deliveredAt when all slots are Delivered.
      const r = await markOrderDelivered(c.id);
      if (!r.ok) {
        errors.push(`${c.reference}: ${r.error}`);
        continue;
      }
      const updated = await prisma.order.findUnique({
        where: { id: c.id },
        include: { items: true },
      });
      if (!updated) {
        errors.push(`${c.reference}: order vanished mid-flip`);
        continue;
      }

      // PLH-2 Phase 4e (E2): pre-fix this `catch` swallowed email failures
      // silently. The order would flip to FULFILLED, the buyer would
      // never get the notification, and nothing told the admin. We can't
      // roll back the status update (the same failing email would
      // re-fail forever and trap the order in PAID), so the failure
      // path now writes an audit row + Sentry so admin can manually
      // re-notify the buyer from /admin/audit.
      try {
        await sendOrderDelivered(updated);
        await prisma.order.update({
          where: { id: c.id },
          data: { deliveryEmailSentAt: new Date() },
        });
      } catch (emailErr) {
        emailFailed++;
        captureError(emailErr, {
          subsystem: "auto-deliver",
          op: "sendOrderDelivered",
          orderId: c.id,
          orderReference: c.reference,
        });
        await writeAuditLog({
          actor: { id: "system", email: "system@partsport" },
          action: "AUTO_DELIVER_EMAIL_FAILED",
          targetType: "Order",
          targetId: c.id,
          summary: `Order ${c.reference} auto-flipped to FULFILLED but the delivery email to ${c.buyerEmail} failed: ${emailErr instanceof Error ? emailErr.message : String(emailErr)}`,
          metadata: {
            orderReference: c.reference,
            buyerEmail: c.buyerEmail,
            error: emailErr instanceof Error ? emailErr.message : String(emailErr),
          },
        });
      }
      delivered++;
    } catch (e) {
      errors.push(`${c.reference}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: batch.length,
    delivered,
    emailFailed,
    errors,
    cutoffDays: AUTO_DELIVER_DAYS,
    hasMore,
  });
}

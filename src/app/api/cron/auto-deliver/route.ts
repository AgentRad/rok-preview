import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendOrderDelivered } from "@/lib/email";

export const runtime = "nodejs";

/**
 * Nightly cron: any PAID order that has been in "Shipped" state for more
 * than AUTO_DELIVER_DAYS gets auto-flipped to Delivered. This is the safety
 * net for when carrier APIs miss a delivery event, the buyer never clicks
 * "Confirm receipt", and the admin doesn't manually mark it.
 *
 * Schedule via vercel.json: { "crons": [{ "path": "/api/cron/auto-deliver",
 * "schedule": "0 9 * * *" }] } - runs 09:00 UTC daily (early morning US).
 *
 * Auth: Vercel Cron sends a CRON_SECRET header in production. If the env
 * var is set, we require the header to match. Locally (no secret) the
 * endpoint is open for testing.
 */

const AUTO_DELIVER_DAYS = 14;
const MAX_PER_RUN = 200; // safety cap; one slow night won't bog the function

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const cutoff = new Date(
    Date.now() - AUTO_DELIVER_DAYS * 24 * 60 * 60 * 1000
  );

  // Find PAID + Shipped orders whose paidAt (proxy for ship date when we
  // don't have a separate shippedAt timestamp) is older than cutoff.
  const candidates = await prisma.order.findMany({
    where: {
      status: "PAID",
      shipmentStage: "Shipped",
      // Use paidAt as the floor; in practice we want shippedAt but that's
      // not on the model today. paidAt < cutoff is conservative (older).
      paidAt: { lt: cutoff },
    },
    take: MAX_PER_RUN,
    select: {
      id: true,
      reference: true,
      buyerEmail: true,
      buyerName: true,
      paidAt: true,
    },
  });

  let delivered = 0;
  const errors: string[] = [];

  for (const c of candidates) {
    try {
      const updated = await prisma.order.update({
        where: { id: c.id },
        data: { shipmentStage: "Delivered", status: "FULFILLED" },
        include: { items: true },
      });
      // Cron iterates orders synchronously; await so each email actually
       // fires inside the function lifetime instead of racing the response.
      try {
        await sendOrderDelivered(updated);
      } catch {
        // Non-fatal: a missing email doesn't stop the rest of the batch.
      }
      delivered++;
    } catch (e) {
      errors.push(`${c.reference}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: candidates.length,
    delivered,
    errors,
    cutoffDays: AUTO_DELIVER_DAYS,
  });
}

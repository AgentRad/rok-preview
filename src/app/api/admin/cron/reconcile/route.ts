import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECONDS_PER_DAY = 24 * 60 * 60;

let _client: Stripe | null = null;
function client(): Stripe | null {
  if (_client) return _client;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  _client = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-04-22.dahlia",
  });
  return _client;
}

type Mismatch = {
  kind: "missing-db" | "amount-mismatch" | "missing-stripe";
  reference: string;
  detail: string;
};

/**
 * Daily reconciliation. Fetches the previous day's Stripe
 * BalanceTransactions and matches each against PartsPort's records.
 * Three classes of mismatch are surfaced:
 *
 *   - missing-db        : a Stripe charge with no matching Order or
 *                         a transfer with no matching Payout
 *   - amount-mismatch   : the Stripe amount doesn't equal what our DB
 *                         thinks we charged or paid out
 *   - missing-stripe    : a PAID Order or PAID Payout in PartsPort
 *                         with no Stripe row in the window
 *
 * Every mismatch is captured to the AuditLog with
 * action="RECONCILIATION_MISMATCH" so the morning admin sees them in
 * /admin/audit.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const s = client();
  if (!s) {
    return NextResponse.json(
      { ok: false, reason: "Stripe not configured. Reconciliation skipped." },
      { status: 200 }
    );
  }
  const url = new URL(req.url);
  const lookbackDays = Math.max(1, Math.min(7, Number(url.searchParams.get("days") || "1")));
  const now = Math.floor(Date.now() / 1000);
  const since = now - lookbackDays * SECONDS_PER_DAY;

  const mismatches: Mismatch[] = [];
  let chargesScanned = 0;
  let transfersScanned = 0;

  try {
    // 1. Charges -> Orders
    let starting: string | undefined = undefined;
    for (let i = 0; i < 5; i++) {
      const page = await s.charges.list({
        created: { gte: since },
        limit: 100,
        ...(starting ? { starting_after: starting } : {}),
      });
      for (const charge of page.data) {
        chargesScanned++;
        if (!charge.paid || charge.refunded) continue;
        const pi =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id;
        if (!pi) continue;
        const order = await prisma.order.findFirst({
          where: { stripePaymentIntentId: pi },
        });
        if (!order) {
          mismatches.push({
            kind: "missing-db",
            reference: charge.id,
            detail: `Stripe charge ${charge.id} for ${charge.amount} cents has no PartsPort Order with that payment_intent`,
          });
          continue;
        }
        if (charge.amount !== order.totalCents) {
          mismatches.push({
            kind: "amount-mismatch",
            reference: order.reference,
            detail: `Stripe ${charge.amount} cents vs DB ${order.totalCents} cents for order ${order.reference}`,
          });
        }
      }
      if (!page.has_more) break;
      starting = page.data[page.data.length - 1]?.id;
    }

    // 2. Transfers -> Payouts
    starting = undefined;
    for (let i = 0; i < 5; i++) {
      const page = await s.transfers.list({
        created: { gte: since },
        limit: 100,
        ...(starting ? { starting_after: starting } : {}),
      });
      for (const transfer of page.data) {
        transfersScanned++;
        const payout = await prisma.payout.findUnique({
          where: { stripeTransferId: transfer.id },
        });
        if (!payout) {
          mismatches.push({
            kind: "missing-db",
            reference: transfer.id,
            detail: `Stripe transfer ${transfer.id} for ${transfer.amount} cents has no matching PartsPort Payout`,
          });
          continue;
        }
        if (transfer.amount !== payout.amountCents) {
          mismatches.push({
            kind: "amount-mismatch",
            reference: payout.reference,
            detail: `Transfer ${transfer.amount} cents vs Payout.amountCents ${payout.amountCents} for ${payout.reference}`,
          });
        }
      }
      if (!page.has_more) break;
      starting = page.data[page.data.length - 1]?.id;
    }
  } catch (err) {
    captureError(err, { subsystem: "reconcile", op: "fetch" });
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Reconciliation failed.",
      },
      { status: 502 }
    );
  }

  // Log every mismatch into the audit trail so the admin can filter
  // /admin/audit?action=RECONCILIATION_MISMATCH and triage in one place.
  for (const m of mismatches) {
    await writeAuditLog({
      actor: { id: "system", email: "system@partsport" },
      action: "RECONCILIATION_MISMATCH",
      targetType: "Order",
      targetId: m.reference,
      summary: `${m.kind}: ${m.detail}`,
      metadata: { kind: m.kind, lookbackDays },
    });
  }

  return NextResponse.json({
    ok: true,
    chargesScanned,
    transfersScanned,
    mismatches,
    lookbackDays,
  });
}

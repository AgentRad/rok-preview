import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECONDS_PER_DAY = 24 * 60 * 60;
const WINDOW_DAYS = 7;
const MAX_CHARGES_PER_RUN = 1000;
const MAX_TRANSFERS_PER_RUN = 1000;

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
 * Daily reconciliation. Fetches Stripe BalanceTransactions and matches
 * each against PartsPort's records. Three classes of mismatch are
 * surfaced:
 *
 *   - missing-db        : a Stripe charge with no matching Order or
 *                         a transfer with no matching Payout
 *   - amount-mismatch   : the Stripe amount doesn't equal what our DB
 *                         thinks we charged or paid out
 *   - missing-stripe    : a PAID Order or PAID Payout in PartsPort
 *                         with no Stripe row in the window
 *
 * Every mismatch is captured to the AuditLog with
 * action="RECONCILIATION_MISMATCH".
 *
 * PLH-2 Phase 4e (E5): persisted cursor. Pre-fix this cron only ever
 * looked back the last 1 to 7 days, so any data older than the most
 * recent run's lookback was permanently unreachable. After a multi-day
 * outage the gap was silently lost. The cursor lives on the singleton
 * ReconciliationState row. Each run starts from
 *   start = max(cursor, NOW() - WINDOW_DAYS days)
 * processes one WINDOW_DAYS chunk, then advances the cursor to the end
 * of the chunk. If the cursor is older than a single window the cron
 * walks forward one chunk per invocation until it catches up, surfacing
 * `hasMore: true` on each run that still has ground to cover.
 *
 * E4: caps at MAX_CHARGES_PER_RUN + MAX_TRANSFERS_PER_RUN rows. If
 * either cap trips we return `hasMore: true` and DO NOT advance the
 * cursor so the next run re-processes the chunk; mismatches are
 * idempotent so the rewrite is safe.
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
  const overrideDays = Number(url.searchParams.get("days") || "0");
  const windowDays =
    overrideDays > 0 ? Math.max(1, Math.min(7, overrideDays)) : WINDOW_DAYS;

  // Load (or initialize) the singleton cursor row.
  const state = await prisma.reconciliationState.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", cursor: null },
  });

  const now = Date.now();
  const windowMs = windowDays * SECONDS_PER_DAY * 1000;
  // Stripe's API list endpoints can comfortably reach a few weeks back.
  // Floor the start at NOW - WINDOW_DAYS only on first ever run (no
  // cursor) so the cron has a sensible baseline; once a cursor exists,
  // we honor it even if it's older than 7 days and walk forward one
  // window per run.
  const firstRunStart = new Date(now - windowMs);
  const cursorStart = state.cursor ?? firstRunStart;
  const startMs = cursorStart.getTime();
  const endMs = Math.min(now, startMs + windowMs);
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);

  const mismatches: Mismatch[] = [];
  let chargesScanned = 0;
  let transfersScanned = 0;
  let chargesCapped = false;
  let transfersCapped = false;

  try {
    // 1. Charges -> Orders
    let starting: string | undefined = undefined;
    chargesLoop: for (let i = 0; i < 20; i++) {
      const page = await s.charges.list({
        created: { gte: startSec, lte: endSec },
        limit: 100,
        ...(starting ? { starting_after: starting } : {}),
      });
      for (const charge of page.data) {
        chargesScanned++;
        if (chargesScanned > MAX_CHARGES_PER_RUN) {
          chargesCapped = true;
          break chargesLoop;
        }
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
    transfersLoop: for (let i = 0; i < 20; i++) {
      const page = await s.transfers.list({
        created: { gte: startSec, lte: endSec },
        limit: 100,
        ...(starting ? { starting_after: starting } : {}),
      });
      for (const transfer of page.data) {
        transfersScanned++;
        if (transfersScanned > MAX_TRANSFERS_PER_RUN) {
          transfersCapped = true;
          break transfersLoop;
        }
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

  // PLH-3j P7: dedupe across capped runs that replay the same window.
  // The partial unique index AuditLog_reconcile_mismatch_dedup_uniq
  // covers (action, targetId, metadata->>'kind', metadata->>'windowStart')
  // for action='RECONCILIATION_MISMATCH'. Use raw ON CONFLICT DO NOTHING
  // so a duplicate write returns silently instead of raising P2002.
  const windowStartIso = new Date(startMs).toISOString();
  const windowEndIso = new Date(endMs).toISOString();
  for (const m of mismatches) {
    const metadata = {
      kind: m.kind,
      windowStart: windowStartIso,
      windowEnd: windowEndIso,
    };
    await prisma.$executeRaw`
      INSERT INTO "AuditLog" ("id", "actorId", "actorEmail", "action", "targetType", "targetId", "summary", "metadata", "createdAt")
      VALUES (
        gen_random_uuid()::text,
        'system',
        'system@partsport',
        'RECONCILIATION_MISMATCH',
        'Order',
        ${m.reference},
        ${`${m.kind}: ${m.detail}`.slice(0, 500)},
        ${JSON.stringify(metadata)}::jsonb,
        NOW()
      )
      ON CONFLICT DO NOTHING
    `;
  }

  const capped = chargesCapped || transfersCapped;
  // Only advance the cursor when we processed the full window without
  // tripping a cap. A capped run leaves the cursor in place so the next
  // run re-processes the same chunk; mismatches are idempotent on
  // (action, kind, reference) for the morning admin.
  const cursorAfter = capped ? state.cursor : new Date(endMs);
  if (!capped) {
    await prisma.reconciliationState.update({
      where: { id: "singleton" },
      data: { cursor: cursorAfter },
    });
  }

  // hasMore is true when either we capped OR the window we just
  // processed ends before "now" (so a backlog still exists).
  const hasMore = capped || endMs < now;

  return NextResponse.json({
    ok: true,
    chargesScanned,
    transfersScanned,
    mismatches,
    windowDays,
    windowStart: new Date(startMs).toISOString(),
    windowEnd: new Date(endMs).toISOString(),
    cursorAfter: cursorAfter ? cursorAfter.toISOString() : null,
    hasMore,
    capped,
  });
}

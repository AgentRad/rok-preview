import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { runArDunning } from "@/lib/dunning";

export const runtime = "nodejs";

/**
 * PLH-3z-4: net-terms dunning cron. Walks unpaid DUE/PAST_DUE invoices, sends
 * the matching cadence-stage email (T-3 / T0 / T+7 / T+30) once per invoice
 * (InvoiceDunningLog idempotency), and auto-suspends the org at T+30. Scheduled
 * daily at 08:15 UTC (after the 09:xx money crons land the prior day, between
 * the two 08:00/08:30 approval-escalate runs). MAX_PER_RUN + hasMore mirror the
 * PLH-2 4e bounded-cron pattern.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runArDunning();
  return NextResponse.json({ ok: true, ...result });
}

import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { runQboReconcile } from "@/lib/qbo-reconcile";

export const runtime = "nodejs";

/**
 * PLH-3i P4: daily QuickBooks Online reconciliation cron.
 *
 * Body extracted in P5 into src/lib/qbo-reconcile.ts so the admin
 * "Run reconcile now" button at /admin/integrations/quickbooks can
 * share the same code path. See that helper for the full design
 * doc on the two-pass invoice + refund backfill, the MAX_PER_RUN
 * cap, and the per-row error handling.
 *
 * Schedule: 07:00 UTC daily (vercel.json).
 */
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runQboReconcile({ op: "qbo-reconcile" });
  return NextResponse.json(result);
}

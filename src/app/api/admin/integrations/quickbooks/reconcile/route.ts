import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runQboReconcile } from "@/lib/qbo-reconcile";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * PLH-3i P5: admin-triggered manual reconcile. Shares the same
 * runQboReconcile helper as the daily cron at /api/cron/qbo-reconcile,
 * but auth-gated to ADMIN session instead of CRON_SECRET so the admin
 * dashboard widget at /admin/integrations/quickbooks can offer a
 * "Run reconcile now" button.
 *
 * Per-row failure handling stays inside the helper. This route only
 * adds the admin auth gate + an audit row recording the manual run.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const result = await runQboReconcile({ op: "qbo-reconcile-admin" });

  await writeAuditLog({
    actor: { id: user.id, email: user.email },
    action: "QBO_RECONCILE_RAN",
    targetType: "IntegrationCredential",
    targetId: "quickbooks_online",
    summary: "Admin triggered manual QuickBooks reconcile.",
    metadata: result as Record<string, unknown>,
  });

  return NextResponse.json(result);
}

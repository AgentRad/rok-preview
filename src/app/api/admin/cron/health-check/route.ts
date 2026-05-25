import { NextResponse } from "next/server";
import Stripe from "stripe";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { sendThreadMessage } from "@/lib/email";
import { writeAuditLog } from "@/lib/audit";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let _client: Stripe | null = null;
function client(): Stripe | null {
  if (_client) return _client;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  _client = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-04-22.dahlia",
  });
  return _client;
}

/**
 * Daily health probe. Currently verifies Stripe Tax is enabled and head-
 * of-status is "active"; future health checks can stack on top. Returns
 * a JSON summary with per-check ok/error so the admin can hit the
 * endpoint manually to see live status without waiting for the email.
 *
 * Captures a warning audit-log entry whenever a check fails so the
 * /admin/audit log surfaces a paper trail.
 */
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const checks: { name: string; ok: boolean; detail: string }[] = [];

  const s = client();
  if (!s) {
    checks.push({
      name: "stripe-configured",
      ok: false,
      detail: "STRIPE_SECRET_KEY is not set; Stripe-dependent features are disabled.",
    });
  } else {
    try {
      const settings = await s.tax.settings.retrieve();
      const status = settings.status as string | undefined;
      checks.push({
        name: "stripe-tax",
        ok: status === "active",
        detail:
          status === "active"
            ? "Stripe Tax is active and computing per-jurisdiction tax on every checkout."
            : `Stripe Tax status is "${status ?? "unknown"}". Enable it in the Stripe dashboard or expect tax to fall through as 0.`,
      });
    } catch (err) {
      captureError(err, { subsystem: "health-check", op: "tax-settings" });
      checks.push({
        name: "stripe-tax",
        ok: false,
        detail:
          err instanceof Error
            ? `Stripe Tax settings call failed: ${err.message}`
            : "Stripe Tax settings call failed.",
      });
    }
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    await writeAuditLog({
      actor: { id: "system", email: "system@partsport" },
      action: "RECONCILIATION_MISMATCH",
      targetType: "Order",
      targetId: "health-check",
      summary: `Health check FAILED: ${failed.map((c) => c.name).join(", ")}`,
      metadata: { failed },
    });
    // Email the admin contact (best-effort, swallow failures).
    try {
      const adminAddr = process.env.ADMIN_NOTIFY_EMAIL || "rad@agentgaming.gg";
      await sendThreadMessage({
        to: adminAddr,
        senderName: "PartsPort Health Check",
        subjectPrefix: "[Health]",
        context: "daily platform health probe",
        body: failed
          .map((c) => `${c.name}: ${c.detail}`)
          .join("\n"),
        threadUrl: "https://partsport.agentgaming.gg/admin",
        threadKind: "order",
        threadId: "health-check",
      });
    } catch (err) {
      captureError(err, { subsystem: "health-check", op: "notify" });
    }
  }

  return NextResponse.json({
    ok: failed.length === 0,
    checks,
  });
}

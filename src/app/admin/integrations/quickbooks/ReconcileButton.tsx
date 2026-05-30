"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * PLH-3i P5: admin "Run reconcile now" button. POSTs to
 * /api/admin/integrations/quickbooks/reconcile and surfaces the
 * result. Auth is enforced server-side on the route.
 */
export default function ReconcileButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    setErr(null);
    try {
      const res = await fetch("/api/admin/integrations/quickbooks/reconcile", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data?.error || `Request failed (${res.status}).`);
      } else if ("skipped" in data) {
        setResult(`Skipped: ${data.skipped}`);
      } else {
        setResult(
          `Invoices: ${data.invoiceSucceeded}/${data.invoiceProcessed} ok, ${data.invoiceFailed} failed. ` +
            `Refunds: ${data.refundSucceeded}/${data.refundProcessed} ok, ${data.refundFailed} failed.`
        );
        router.refresh();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={run}
        disabled={busy || disabled}
      >
        {busy ? "Running reconcile..." : "Run reconcile now"}
      </button>
      {result ? (
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          {result}
        </p>
      ) : null}
      {err ? (
        <p style={{ marginTop: 8, fontSize: 13, color: "#c0392b" }}>{err}</p>
      ) : null}
    </div>
  );
}

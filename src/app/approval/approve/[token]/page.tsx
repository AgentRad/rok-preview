"use client";
import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";

/**
 * QA1-fix4 BUG 2: approval confirmation page. Reached from the one-click
 * approve link in the approver email. Approving must require an explicit human
 * action (a button POST), since mail scanners and link-preview bots issue GET
 * on inbound-mail links and would otherwise silently approve over-limit orders.
 * Mirrors /approval/reject/[token]; POSTs action=approve to the decide API.
 */
export default function ApprovalApprovePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = String(params.token || "");
  const orderId = searchParams.get("order") || "";
  const memberId = searchParams.get("member") || "";

  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!token || !orderId || !memberId) setStatus("error");
  }, [token, orderId, memberId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    try {
      const res = await fetch(
        `/api/approval/decide?order=${encodeURIComponent(orderId)}&member=${encodeURIComponent(memberId)}&action=approve&t=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      if (res.ok || res.redirected) {
        setStatus("done");
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error || "Could not process approval.");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <div style={{ maxWidth: 480, width: "100%", background: "#fff", border: "1px solid #e2e0d9", borderRadius: 5, padding: "2rem" }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "#9b988d", marginBottom: 8 }}>PartsPort</div>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>Approve order</h1>

        {status === "done" && (
          <div style={{ color: "var(--mid, #6f6d64)", padding: "1rem 0" }}>
            <p>The order has been approved.</p>
            <a href={`/orders/${orderId}`} style={{ color: "var(--blue, #1d4ed8)", textDecoration: "underline" }}>
              View order
            </a>
          </div>
        )}

        {status === "error" && !errorMsg && (
          <p style={{ color: "var(--red, #b91c1c)" }}>This link is invalid or has already been used.</p>
        )}

        {(status === "idle" || status === "submitting" || (status === "error" && errorMsg)) && (
          <form onSubmit={submit}>
            <p style={{ color: "var(--mid, #6f6d64)", marginBottom: "1rem", fontSize: "0.9rem" }}>
              Confirm that you want to approve this order so it can proceed to payment.
            </p>
            {status === "error" && errorMsg && (
              <p style={{ color: "var(--red, #b91c1c)", marginBottom: "0.5rem", fontSize: "0.85rem" }}>{errorMsg}</p>
            )}
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                type="submit"
                disabled={status === "submitting"}
                style={{ background: "#1a1916", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 4, fontWeight: 500, cursor: "pointer" }}
              >
                {status === "submitting" ? "Approving..." : "Confirm approval"}
              </button>
              <a
                href={`/orders/${orderId}`}
                style={{ padding: "10px 20px", border: "1px solid #e2e0d9", borderRadius: 4, textDecoration: "none", color: "var(--near-black, #1a1916)", fontSize: "0.9rem" }}
              >
                Cancel
              </a>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

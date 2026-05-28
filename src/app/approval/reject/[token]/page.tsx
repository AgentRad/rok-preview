"use client";
import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";

/**
 * PLH-3y-6 C4: rejection confirmation page. Reached from the one-click
 * reject link in the approver email. Collects a reason and POSTs to the
 * decide API with action=reject + reason in the body.
 */
export default function ApprovalRejectPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = String(params.token || "");
  const orderId = searchParams.get("order") || "";
  const memberId = searchParams.get("member") || "";

  const [reason, setReason] = useState("");
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
        `/api/approval/decide?order=${encodeURIComponent(orderId)}&member=${encodeURIComponent(memberId)}&action=reject&t=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }
      );
      if (res.ok || res.redirected) {
        setStatus("done");
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error || "Could not process rejection.");
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
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>Reject order</h1>

        {status === "done" && (
          <div style={{ color: "var(--mid, #6f6d64)", padding: "1rem 0" }}>
            <p>The order has been rejected.</p>
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
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem" }}>
              Reason for rejection <span style={{ color: "var(--mid)" }}>(optional, shared with the requester)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              style={{ width: "100%", padding: "0.5rem", fontSize: "0.9rem", border: "1px solid #e2e0d9", borderRadius: 4, marginBottom: "1rem", boxSizing: "border-box" }}
              placeholder="Budget exceeded, needs additional documentation, etc."
            />
            {status === "error" && errorMsg && (
              <p style={{ color: "var(--red, #b91c1c)", marginBottom: "0.5rem", fontSize: "0.85rem" }}>{errorMsg}</p>
            )}
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                type="submit"
                disabled={status === "submitting"}
                style={{ background: "#b91c1c", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 4, fontWeight: 500, cursor: "pointer" }}
              >
                {status === "submitting" ? "Rejecting..." : "Confirm rejection"}
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

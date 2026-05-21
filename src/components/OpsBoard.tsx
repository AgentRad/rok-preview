"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export type OpsOrder = {
  id: string;
  reference: string;
  buyerName: string;
  shipTo: string;
  placed: string;
  total: string;
  itemCount: number;
  status: string;
  shipmentStage: string;
  carrier: string | null;
  trackingCode: string | null;
};

const STAGES = ["New", "Processing", "Shipped", "Delivered"] as const;
type StageName = (typeof STAGES)[number];

const BLURB: Record<StageName, string> = {
  New: "Paid and waiting to be picked up by the fulfillment team.",
  Processing: "Being picked, packed, and prepared for carrier handoff.",
  Shipped: "In transit to the buyer, with a tracking number assigned.",
  Delivered: "Completed and handed to the buyer.",
};

function effectiveStage(o: OpsOrder): StageName {
  if (o.status === "FULFILLED" || o.shipmentStage === "Delivered") return "Delivered";
  if (o.shipmentStage === "Shipped") return "Shipped";
  if (o.shipmentStage === "Processing") return "Processing";
  return "New";
}

export default function OpsBoard({ orders }: { orders: OpsOrder[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [ship, setShip] = useState<Record<string, { carrier: string; trackingCode: string }>>({});

  async function advance(
    id: string,
    stage: StageName,
    extra?: { carrier: string; trackingCode: string }
  ) {
    setBusy(id);
    setErr("");
    const res = await fetch(`/api/ops/orders/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, ...extra }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(d.error || "Could not update the order.");
      setBusy(null);
      return;
    }
    setBusy(null);
    router.refresh();
  }

  const grouped: Record<StageName, OpsOrder[]> = {
    New: [],
    Processing: [],
    Shipped: [],
    Delivered: [],
  };
  for (const o of orders) grouped[effectiveStage(o)].push(o);

  return (
    <div>
      {err && (
        <div className="card" style={{ borderColor: "var(--red, #c0392b)", marginBottom: 16 }}>
          <div style={{ padding: "12px 16px", color: "var(--red, #c0392b)", fontSize: 13.5 }}>
            {err}
          </div>
        </div>
      )}

      {STAGES.map((stage) => {
        const list = grouped[stage];
        return (
          <div className="card" key={stage}>
            <div className="card-head">
              <h2>
                {stage}{" "}
                <span className="badge badge-pending" style={{ marginLeft: 6 }}>
                  {list.length}
                </span>
              </h2>
            </div>
            <p className="muted-text" style={{ fontSize: 12.5, margin: "0 0 6px" }}>
              {BLURB[stage]}
            </p>

            {list.length === 0 ? (
              <div className="empty-block">
                <p style={{ margin: 0 }}>Nothing at this stage.</p>
              </div>
            ) : (
              list.map((o) => {
                const s = ship[o.id] || { carrier: "", trackingCode: "" };
                return (
                  <div
                    key={o.id}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 16,
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "14px 0",
                      borderTop: "1px solid var(--line)",
                    }}
                  >
                    <div style={{ minWidth: 220 }}>
                      <div style={{ fontWeight: 700 }}>
                        {o.reference}{" "}
                        <Link
                          href={`/orders/${o.id}`}
                          style={{ color: "var(--blue)", fontWeight: 600, fontSize: 12.5, marginLeft: 6 }}
                        >
                          View
                        </Link>
                      </div>
                      <div style={{ fontSize: 13 }}>{o.buyerName}</div>
                      <div className="muted-text" style={{ fontSize: 11.5 }}>
                        Ship to {o.shipTo}
                      </div>
                      <div className="muted-text" style={{ fontSize: 11.5 }}>
                        {o.itemCount} item{o.itemCount === 1 ? "" : "s"} · {o.total} · placed {o.placed}
                      </div>
                      {o.trackingCode && (
                        <div className="muted-text" style={{ fontSize: 11.5 }}>
                          {o.carrier}: {o.trackingCode}
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {stage === "New" && (
                        <button
                          className="btn btn-primary"
                          disabled={busy === o.id}
                          onClick={() => advance(o.id, "Processing")}
                        >
                          {busy === o.id ? "Saving…" : "Start processing"}
                        </button>
                      )}

                      {stage === "Processing" && (
                        <>
                          <input
                            type="text"
                            placeholder="Carrier"
                            value={s.carrier}
                            onChange={(e) =>
                              setShip((m) => ({
                                ...m,
                                [o.id]: { ...s, carrier: e.target.value },
                              }))
                            }
                            style={{ width: 130 }}
                          />
                          <input
                            type="text"
                            placeholder="Tracking number"
                            value={s.trackingCode}
                            onChange={(e) =>
                              setShip((m) => ({
                                ...m,
                                [o.id]: { ...s, trackingCode: e.target.value },
                              }))
                            }
                            style={{ width: 170 }}
                          />
                          <button
                            className="btn btn-primary"
                            disabled={busy === o.id || !s.carrier.trim() || !s.trackingCode.trim()}
                            onClick={() => advance(o.id, "Shipped", s)}
                          >
                            {busy === o.id ? "Saving…" : "Mark shipped"}
                          </button>
                        </>
                      )}

                      {stage === "Shipped" && (
                        <button
                          className="btn btn-primary"
                          disabled={busy === o.id}
                          onClick={() => advance(o.id, "Delivered")}
                        >
                          {busy === o.id ? "Saving…" : "Mark delivered"}
                        </button>
                      )}

                      {stage === "Delivered" && (
                        <span className="badge badge-fulfilled">Delivered</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}

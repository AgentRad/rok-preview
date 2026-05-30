import Link from "next/link";
import { formatCents } from "@/lib/money";
import type { loadSupplierReserveTxns } from "./data";

type Txns = Awaited<ReturnType<typeof loadSupplierReserveTxns>>;

// PLH-3l P2: extracted from /supplier/page.tsx Reserve & balance card.
export default function ReserveBalanceCard({
  reserveBalanceCents,
  owedToPlatformCents,
  reservePercent,
  reserveTxns,
}: {
  reserveBalanceCents: number;
  owedToPlatformCents: number;
  reservePercent: number;
  reserveTxns: Txns;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Reserve &amp; balance</h2>
        <div style={{ display: "flex", gap: 18, fontSize: 13 }}>
          <span className="muted-text">
            Reserve held{" "}
            <strong style={{ color: "var(--ink)" }}>
              {formatCents(reserveBalanceCents)}
            </strong>
          </span>
          <span className="muted-text">
            Owed to platform{" "}
            <strong
              style={{
                color:
                  owedToPlatformCents > 0 ? "var(--amber-deep)" : "var(--ink)",
              }}
            >
              {formatCents(owedToPlatformCents)}
            </strong>{" "}
            <Link
              href="/legal/supplier-agreement"
              style={{ fontSize: 11, color: "var(--muted)" }}
            >
              Why?
            </Link>
          </span>
        </div>
      </div>
      {reserveTxns.length === 0 ? (
        <div className="empty-block">
          <h3>No reserve activity yet</h3>
          <p>
            PartsPort holds {(reservePercent / 100).toFixed(1)}% of each payout
            as a chargeback reserve, released after 60 days when no refund or
            chargeback hits the order.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th className="num">Amount</th>
                <th>Order</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {reserveTxns.map((t) => (
                <tr key={t.id}>
                  <td>{t.createdAt.toLocaleDateString()}</td>
                  <td>
                    <span
                      className={
                        "badge " +
                        (t.type === "HOLD"
                          ? "badge-pending"
                          : t.type === "RELEASE"
                            ? "badge-fulfilled"
                            : t.type === "OWED_INCURRED"
                              ? "badge-cancelled"
                              : "badge-paid")
                      }
                    >
                      {t.type}
                    </span>
                  </td>
                  <td className="num">{formatCents(t.amountCents)}</td>
                  <td>{t.orderId ? t.orderId.slice(-6) : ""}</td>
                  <td className="muted-text" style={{ fontSize: 12.5 }}>
                    {t.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

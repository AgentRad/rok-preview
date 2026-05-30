import { formatCents } from "@/lib/money";
import type { loadSupplierPayouts } from "./data";

type Payouts = Awaited<ReturnType<typeof loadSupplierPayouts>>;

// PLH-3l P2: extracted from /supplier/page.tsx Payouts card.
export default function PayoutsTable({ payouts }: { payouts: Payouts }) {
  const payoutsDue = payouts
    .filter((p) => p.status === "DUE")
    .reduce((s, p) => s + p.amountCents, 0);
  const payoutsPaid = payouts
    .filter((p) => p.status === "PAID")
    .reduce((s, p) => s + p.amountCents, 0);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Payouts</h2>
        <div style={{ display: "flex", gap: 18, fontSize: 13 }}>
          <span className="muted-text">
            Due{" "}
            <strong style={{ color: "var(--ink)" }}>
              {formatCents(payoutsDue)}
            </strong>
          </span>
          <span className="muted-text">
            Paid{" "}
            <strong style={{ color: "var(--ink)" }}>
              {formatCents(payoutsPaid)}
            </strong>
          </span>
        </div>
      </div>
      {payouts.length === 0 ? (
        <div className="empty-block">
          <h3>No payouts yet</h3>
          <p>Payouts are created when an order is dispatched.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Order</th>
                <th>Created</th>
                <th>Status</th>
                <th className="num">Amount</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 700 }}>{p.reference}</td>
                  <td>{p.order.reference}</td>
                  <td>{p.createdAt.toLocaleDateString()}</td>
                  <td>
                    <span
                      className={
                        "badge " +
                        (p.status === "PAID"
                          ? "badge-fulfilled"
                          : "badge-pending")
                      }
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="num">{formatCents(p.amountCents)}</td>
                  <td>
                    {p.paidAt ? p.paidAt.toLocaleDateString() : "Not paid"}
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

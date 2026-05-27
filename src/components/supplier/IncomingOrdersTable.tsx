import FulfillButton from "@/components/FulfillButton";
import { formatCents } from "@/lib/money";
import type { loadSupplierOrders } from "./data";

type Orders = Awaited<ReturnType<typeof loadSupplierOrders>>;

// PLH-3l P2: extracted from /supplier/page.tsx Incoming orders card.
// Replaced by a compact tile on the dashboard in P6, but kept here so
// other surfaces can render the full table if needed.
export default function IncomingOrdersTable({
  orders,
  supplierId,
  canFulfill,
}: {
  orders: Orders;
  supplierId: string;
  canFulfill: boolean;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Incoming orders</h2>
      </div>
      {orders.length === 0 ? (
        <div className="empty-block">
          <h3>No orders yet</h3>
          <p>Paid orders containing your parts will appear here.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Your items</th>
                <th>Status</th>
                <th className="num">Your total</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const mine = o.items.filter(
                  (i) => i.product.supplierId === supplierId
                );
                const slot = o.supplierSlots[0] ?? null;
                const mineTotal = slot
                  ? slot.subtotalCents + slot.freightCents
                  : mine.reduce((s, i) => s + i.unitPriceCents * i.qty, 0);
                const slotStage = slot?.shipmentStage ?? "Pending";
                return (
                  <tr key={o.id}>
                    <td style={{ fontWeight: 700 }}>{o.reference}</td>
                    <td>{o.createdAt.toLocaleDateString()}</td>
                    <td>
                      {mine.map((i) => (
                        <div key={i.id} style={{ fontSize: 12.5 }}>
                          {i.qty} × {i.nameSnapshot}
                        </div>
                      ))}
                    </td>
                    <td>
                      <span
                        className={
                          "badge " +
                          (slotStage === "Shipped" || slotStage === "Delivered"
                            ? "badge-fulfilled"
                            : "badge-pending")
                        }
                      >
                        {slotStage}
                      </span>
                    </td>
                    <td className="num">{formatCents(mineTotal)}</td>
                    <td className="num">
                      {o.status === "PAID" &&
                        slot &&
                        slotStage !== "Shipped" &&
                        slotStage !== "Delivered" &&
                        canFulfill && (
                          <FulfillButton orderId={o.id} slotId={slot.id} />
                        )}
                      {o.status === "PAID" && slotStage === "Shipped" && (
                        <span
                          className="muted-text"
                          style={{ fontSize: 12 }}
                        >
                          Shipped {slot?.carrier ?? ""}{" "}
                          {slot?.trackingCode ?? ""}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import FulfillButton from "@/components/FulfillButton";
import UnreadBadge from "@/components/UnreadBadge";
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
  unreadByOrderId,
}: {
  orders: Orders;
  supplierId: string;
  canFulfill: boolean;
  unreadByOrderId?: Record<string, number>;
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
                // PLH-3z-4: net-terms orders ship before the buyer pays; the
                // supplier payout fires when the buyer pays the invoice (LOCKED
                // hold policy). Surface that to the supplier so the delay is
                // expected, not a surprise.
                const isNetTerms = o.paymentTerms !== "PREPAID";
                const termsLabel = isNetTerms
                  ? o.paymentTerms.replace("NET_", "Net ")
                  : "";
                const dueStr = o.invoiceDueDate
                  ? new Date(o.invoiceDueDate).toLocaleDateString()
                  : "the invoice due date";
                // Net-terms orders are shippable while PENDING; prepaid require PAID.
                const canShipNow =
                  (o.status === "PAID" || (isNetTerms && o.status === "PENDING")) &&
                  slot &&
                  slotStage !== "Shipped" &&
                  slotStage !== "Delivered" &&
                  canFulfill;
                return (
                  <tr key={o.id}>
                    <td style={{ fontWeight: 700 }}>
                      {o.reference}
                      <UnreadBadge
                        count={unreadByOrderId?.[o.id] ?? 0}
                        variant="dot"
                        ariaLabel="Unread messages"
                      />
                      {isNetTerms && (
                        <div
                          className="muted-text"
                          style={{ fontSize: 11.5, fontWeight: 400, marginTop: 3 }}
                        >
                          Buyer on {termsLabel} terms. Payout fires when the buyer
                          pays the invoice (due {dueStr}).
                        </div>
                      )}
                    </td>
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
                      {canShipNow && slot && (
                        <FulfillButton orderId={o.id} slotId={slot.id} />
                      )}
                      {slotStage === "Shipped" && (
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

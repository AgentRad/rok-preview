import Link from "next/link";
import QuoteResponder from "@/components/QuoteResponder";
import UnreadBadge from "@/components/UnreadBadge";
import { formatCents } from "@/lib/money";
import type { loadSupplierQuotes } from "./data";

type Quotes = Awaited<ReturnType<typeof loadSupplierQuotes>>;

const STATUS_CLASS: Record<string, string> = {
  PAID: "badge-paid",
  FULFILLED: "badge-fulfilled",
  OPEN: "badge-pending",
  QUOTED: "badge-paid",
};

// PLH-3l P2: extracted from /supplier/page.tsx Quote requests card.
export default function QuoteRequestsTable({
  quotes,
  canRespond,
  unreadByQuoteId,
}: {
  quotes: Quotes;
  canRespond: boolean;
  unreadByQuoteId?: Record<string, number>;
}) {
  const openQuotes = quotes.filter((q) => q.status === "OPEN").length;
  return (
    <div className="card">
      <div className="card-head">
        <h2>
          Quote requests{openQuotes > 0 ? ` · ${openQuotes} open` : ""}
        </h2>
      </div>
      {quotes.length === 0 ? (
        <div className="empty-block">
          <h3>No quote requests</h3>
          <p>RFQs for your quote-only listings appear here.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Product</th>
                <th>Buyer</th>
                <th>Qty</th>
                <th>Status</th>
                <th>Respond</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id}>
                  <td>
                    <Link
                      href={`/quotes/${q.id}`}
                      style={{
                        color: "var(--blue)",
                        fontWeight: 600,
                        textDecoration: "none",
                      }}
                    >
                      {q.reference}
                    </Link>
                    <UnreadBadge
                      count={unreadByQuoteId?.[q.id] ?? 0}
                      variant="dot"
                      ariaLabel="Unread messages"
                    />
                  </td>
                  <td style={{ fontSize: 13 }}>{q.product.name}</td>
                  <td>
                    <div style={{ fontSize: 13 }}>{q.buyerName}</div>
                    <div
                      className="muted-text"
                      style={{ fontSize: 11.5 }}
                    >
                      {q.buyerEmail}
                    </div>
                  </td>
                  <td className="num">{q.qty}</td>
                  <td>
                    <span
                      className={"badge " + (STATUS_CLASS[q.status] || "")}
                    >
                      {q.status}
                    </span>
                  </td>
                  <td className="num">
                    {q.status === "OPEN" && canRespond ? (
                      <QuoteResponder quoteId={q.id} />
                    ) : q.quotedUnitCents != null ? (
                      `${formatCents(q.quotedUnitCents)} / unit`
                    ) : (
                      <span
                        className="muted-text"
                        style={{ fontSize: 12 }}
                      >
                        {canRespond ? "Sent" : "Awaiting response"}
                      </span>
                    )}
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

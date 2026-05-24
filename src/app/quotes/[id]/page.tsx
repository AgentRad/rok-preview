import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ProductImage from "@/components/ProductImage";
import QuoteActions from "@/components/QuoteActions";
import MessageThread from "@/components/MessageThread";
import { formatCents, feeFor } from "@/lib/money";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  OPEN: "badge-pending",
  QUOTED: "badge-paid",
  ACCEPTED: "badge-fulfilled",
  DECLINED: "badge-cancelled",
};

export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const quote = await prisma.quoteRequest.findUnique({
    where: { id },
    include: {
      product: { include: { supplier: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!quote) notFound();

  const viewer = await getCurrentUser();
  const isBuyer = !!viewer && !!quote.buyerId && viewer.id === quote.buyerId;
  const isAdmin = viewer?.role === "ADMIN";
  const isQuoteSupplier =
    viewer?.role === "SUPPLIER" &&
    quote.product.supplier.userId === viewer.id;
  const canMessage = !!viewer && (isBuyer || isAdmin || isQuoteSupplier);

  const p = quote.product;
  const quoted = quote.quotedUnitCents != null;
  const subtotal = quoted ? quote.quotedUnitCents! * quote.qty : 0;
  const freight = 0;
  const fee = feeFor(subtotal);
  const tax = 0;
  const total = subtotal + freight + fee + tax;

  return (
    <>
      <SiteHeader />
      <main id="main">
        <div className="page-pad narrow">
          <div className="breadcrumb">
            <Link href="/catalog">Catalog</Link> › Quote {quote.reference}
          </div>
          <h1 className="page-title">Quote request</h1>
          <p className="page-sub">
            {quote.reference} · submitted {quote.createdAt.toLocaleDateString()}{" "}
            ·{" "}
            <span className={"badge " + (STATUS_CLASS[quote.status] || "")}>
              {quote.status}
            </span>
          </p>

          {quote.status === "OPEN" && (
            <div className="alert alert-info" style={{ marginTop: 18 }}>
              Request received. A vetted supplier is preparing your price.
              You&rsquo;ll see it here, typically within one business day.
            </div>
          )}
          {quote.status === "ACCEPTED" && quote.orderId && (
            <div className="alert alert-ok" style={{ marginTop: 18 }}>
              ✓ Quote accepted. An order has been created.{" "}
              <Link href={`/orders/${quote.orderId}`} style={{ color: "inherit", fontWeight: 700 }}>
                Go to your order →
              </Link>
            </div>
          )}
          {quote.status === "DECLINED" && (
            <div className="alert alert-error" style={{ marginTop: 18 }}>
              This quote was declined. You can request a new quote from the
              product page anytime.
            </div>
          )}

          <div className="card" style={{ marginTop: 22 }}>
            <div className="card-body">
              <div className="quote-product">
                <div className="quote-thumb">
                  <ProductImage imageUrl={p.imageUrl} icon={p.icon} name={p.name} />
                </div>
                <div>
                  <div className="product-mfr">{p.manufacturer}</div>
                  <div style={{ fontWeight: 600, fontSize: 16, marginTop: 3 }}>
                    {p.name}
                  </div>
                  <div className="muted-text" style={{ fontSize: 13, marginTop: 4 }}>
                    SKU {p.sku} · Quantity {quote.qty} · Supplier {p.supplier.name}
                  </div>
                </div>
              </div>
              {quote.message && (
                <p className="muted-text" style={{ fontSize: 13.5, marginTop: 14, lineHeight: 1.6 }}>
                  <strong style={{ color: "var(--ink)" }}>Your notes:</strong>{" "}
                  {quote.message}
                </p>
              )}
            </div>
          </div>

          {quote.status === "QUOTED" && quoted && (
            <div className="card" style={{ marginTop: 22 }}>
              <div className="card-head">
                <h2>Supplier quote</h2>
              </div>
              <div className="card-body">
                <div className="summary-line">
                  <span>Unit price</span>
                  <span>{formatCents(quote.quotedUnitCents!)}</span>
                </div>
                <div className="summary-line">
                  <span>Quantity</span>
                  <span>× {quote.qty}</span>
                </div>
                <div className="summary-line">
                  <span>Subtotal</span>
                  <span>{formatCents(subtotal)}</span>
                </div>
                <div className="summary-line">
                  <span>Freight</span>
                  <span>{formatCents(freight)}</span>
                </div>
                <div className="summary-line">
                  <span>Platform fee (4%)</span>
                  <span style={{ color: "var(--amber-deep)" }}>{formatCents(fee)}</span>
                </div>
                <div className="summary-line">
                  <span>Sales tax</span>
                  <span>{formatCents(tax)}</span>
                </div>
                <div className="summary-line total">
                  <span>Order total</span>
                  <span>{formatCents(total)}</span>
                </div>
                {quote.quoteNote && (
                  <p className="muted-text" style={{ fontSize: 13, margin: "10px 0 16px" }}>
                    <strong style={{ color: "var(--ink)" }}>Supplier note:</strong>{" "}
                    {quote.quoteNote}
                  </p>
                )}
                <div style={{ marginTop: 14 }}>
                  <QuoteActions quoteId={quote.id} />
                </div>
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: 22 }}>
            <div className="card-head">
              <h2>Messages{quote.messages.length > 0 ? ` · ${quote.messages.length}` : ""}</h2>
            </div>
            <div className="card-body">
              <MessageThread
                quoteId={quote.id}
                canPost={canMessage}
                messages={quote.messages.map((m) => ({
                  id: m.id,
                  senderName: m.senderName,
                  senderRole: m.senderRole,
                  body: m.body,
                  createdAt: m.createdAt.toISOString(),
                }))}
              />
            </div>
          </div>

          <div style={{ marginTop: 24 }} className="row-gap">
            <Link className="btn btn-ghost" href="/catalog">
              Back to catalog
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import CheckoutFromQuoteClient from "@/components/CheckoutFromQuoteClient";
import { formatCents, feeFor, FEE_RATE_LABEL } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Polish 12 C2: bridge page between an ACCEPTED quote and Stripe
 * Checkout. Collects shipping (for freight + Order.shipTo), shows the
 * locked unit price + estimated fee, and on submit POSTs to the
 * /api/checkout-from-quote/[id] route which computes server-trusted
 * freight via Shippo, creates the PENDING Order, and returns the
 * Stripe Checkout URL.
 */
export default async function CheckoutFromQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const quote = await prisma.quoteRequest.findUnique({
    where: { id },
    include: { product: { include: { supplier: true } } },
  });
  if (!quote) notFound();
  if (quote.status !== "ACCEPTED" || quote.quotedUnitCents == null) {
    redirect(`/quotes/${quote.id}`);
  }
  if (quote.orderId) {
    const existing = await prisma.order.findUnique({
      where: { id: quote.orderId },
    });
    if (existing && existing.status !== "PENDING") {
      redirect(`/orders/${existing.id}`);
    }
  }

  const viewer = await getCurrentUser();
  const isOwner =
    (!!quote.buyerId && viewer?.id === quote.buyerId) ||
    viewer?.role === "ADMIN";

  const subtotal = quote.quotedUnitCents * quote.qty;
  const fee = feeFor(subtotal);

  return (
    <>
      <SiteHeader />
      <main id="main" className="app-page">
        <div className="page-pad narrow">
          <div className="breadcrumb">
            <Link href={`/quotes/${quote.id}`}>Quote {quote.reference}</Link> ›
            Checkout
          </div>
          <h1 className="page-title">Finish your quote</h1>
          <p className="page-sub">
            One last step. Enter the ship-to address. We compute live freight,
            then send you to Stripe for tax and payment.
          </p>

          <div className="card" style={{ marginTop: 22 }}>
            <div className="card-head">
              <h2>Locked from the quote</h2>
            </div>
            <div className="card-body">
              <div className="summary-line">
                <span>
                  {quote.product.name}
                  <span className="muted-text" style={{ marginLeft: 8 }}>
                    SKU {quote.product.sku}
                  </span>
                </span>
                <span>× {quote.qty}</span>
              </div>
              <div className="summary-line">
                <span>Unit price</span>
                <span>{formatCents(quote.quotedUnitCents)}</span>
              </div>
              <div className="summary-line">
                <span>Subtotal</span>
                <span>{formatCents(subtotal)}</span>
              </div>
              <div className="summary-line">
                <span>Platform fee ({FEE_RATE_LABEL})</span>
                <span style={{ color: "var(--amber-deep)" }}>
                  {formatCents(fee)}
                </span>
              </div>
              <p
                className="muted-text"
                style={{ fontSize: 12.5, marginTop: 10 }}
              >
                Freight is priced live below. Sales tax is computed by Stripe at
                payment time based on the ship-to state.
              </p>
            </div>
          </div>

          <CheckoutFromQuoteClient
            quoteId={quote.id}
            isOwner={isOwner}
            buyerEmailHint={quote.buyerEmail}
            defaults={{
              name: viewer?.name || quote.buyerName,
              company: viewer?.companyName || quote.company,
            }}
          />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

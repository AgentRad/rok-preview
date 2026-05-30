import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Polish 12 C1+C2: RFQ accept gating + deferred order creation.
 *
 * Previously this route created an Order immediately with freight=0,
 * tax=0, and shipTo="To be confirmed", and had ZERO auth. The audit
 * round flagged both as launch-blockers: anyone with the quote id
 * could accept on behalf of the buyer, and the resulting Order had no
 * real shipping or tax cost.
 *
 * New flow:
 *   1. POST /api/quotes/[id]/accept verifies the caller is either the
 *      session user matching quote.buyerId OR a guest passing the
 *      buyer's email in the body. Rate-limited 5/hour/IP to stop
 *      brute-force enumeration.
 *   2. The quote flips to ACCEPTED but Order is NOT created here.
 *      orderId stays null until checkout completes. The buyer is
 *      redirected to /checkout-from-quote/[id] which collects shipping,
 *      computes server-trusted freight via Shippo, then redirects to
 *      Stripe Checkout where Stripe Tax computes real tax.
 *   3. On Stripe webhook success the Order is created with real values.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const limit = await rateLimit("order", `quote-accept:${clientIp(req)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many accept attempts. Please wait a few minutes." },
      { status: 429 }
    );
  }

  const quote = await prisma.quoteRequest.findUnique({
    where: { id },
    include: { product: { include: { supplier: true } } },
  });
  if (!quote) {
    return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  }

  // Authorize. Owner session OR guest email match against the quote's
  // buyerEmail. No anonymous accept.
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const providedEmail = String(body.email || "").toLowerCase().trim();

  const isOwner = !!quote.buyerId && user?.id === quote.buyerId;
  const guestMatch =
    !user && providedEmail.length > 0 && providedEmail === quote.buyerEmail.toLowerCase();
  if (!isOwner && !guestMatch && user?.role !== "ADMIN") {
    return NextResponse.json(
      { error: "You are not allowed to accept this quote." },
      { status: 401 }
    );
  }
  // H3+H4: signed-in users must verify their email before accepting.
  // The guest path (guestMatch) is gated by the email match itself, so
  // it doesn't need verification.
  if (user && !user.emailVerified && user.role !== "ADMIN") {
    return NextResponse.json(
      {
        error:
          "Verify your email before accepting a quote. Request a new verification link from /account.",
        code: "EMAIL_NOT_VERIFIED",
      },
      { status: 403 }
    );
  }

  // Idempotent: already-accepted quotes just route the buyer to the
  // right destination. If an Order was created (legacy path), send the
  // buyer to the order page. If not, send them to the new checkout
  // bridge to finish payment.
  if (quote.status === "ACCEPTED") {
    if (quote.orderId) {
      return NextResponse.json({ ok: true, orderId: quote.orderId });
    }
    return NextResponse.json({
      ok: true,
      redirect: `/checkout-from-quote/${quote.id}`,
    });
  }

  if (quote.status !== "QUOTED" || quote.quotedUnitCents == null) {
    return NextResponse.json(
      { error: "This quote is not ready to accept yet." },
      { status: 400 }
    );
  }

  // H1 expiry. Reject 410 once past quoteExpiresAt.
  if (quote.quoteExpiresAt && quote.quoteExpiresAt.getTime() < Date.now()) {
    return NextResponse.json(
      { error: "This quote has expired. Please request a new quote." },
      { status: 410 }
    );
  }

  await prisma.quoteRequest.update({
    where: { id },
    data: { status: "ACCEPTED" },
  });

  await writeAuditLog({
    actor: {
      id: user?.id || "guest",
      email: user?.email || providedEmail || quote.buyerEmail,
    },
    action: "QUOTE_ACCEPTED",
    targetType: "QuoteRequest",
    targetId: quote.id,
    summary: `Quote ${quote.reference} accepted; awaiting checkout.`,
    metadata: {
      quoteReference: quote.reference,
      productSku: quote.product.sku,
      qty: quote.qty,
      quotedUnitCents: quote.quotedUnitCents,
    },
  });

  return NextResponse.json({
    ok: true,
    redirect: `/checkout-from-quote/${quote.id}`,
  });
}

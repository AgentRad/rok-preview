import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { generateReference } from "@/lib/order-utils";
import { effectiveBps, feeFor } from "@/lib/money";
import { getFreightRates, isShippoConfigured } from "@/lib/freight-server";
import { calculateFreight } from "@/lib/freight";
import { getProvider, type CheckoutLineItem } from "@/lib/payments";
import { lookupTaxExemption } from "@/lib/stripe-tax";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

/**
 * Polish 12 C1+C2: convert an ACCEPTED quote into a PENDING Order with
 * server-trusted freight + real ship-to address, then hand off to
 * Stripe Checkout where Stripe Tax computes per-jurisdiction tax.
 *
 * Auth: same model as /api/quotes/[id]/accept. Owner session OR guest
 * email match. Rate-limited.
 *
 * Server-trusts unit price (locks to quote.quotedUnitCents), freight
 * (re-quoted server-side via Shippo with fallback to the flat-rate
 * calculator), and fee (6% of subtotal at quoted price). Tax is left
 * to Stripe Tax via the existing payments/create-session path.
 *
 * Returns { ok, url } where url is the Stripe Checkout URL. On Stripe
 * webhook success the Order flips to PAID with real tax baked in;
 * quote.orderId is wired up at the moment of order creation here so a
 * second submission collides on the existing PENDING order rather
 * than creating a duplicate (H2 idempotency).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const limit = await rateLimit("order", `quote-checkout:${clientIp(req)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many checkout attempts. Please wait and try again." },
      { status: 429 }
    );
  }

  const quote = await prisma.quoteRequest.findUnique({
    where: { id },
    include: { product: { include: { supplier: { include: { warehouses: true } } } } },
  });
  if (!quote) {
    return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  }

  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const providedEmail = String(body.email || "").toLowerCase().trim();
  const isOwner = !!quote.buyerId && user?.id === quote.buyerId;
  const guestMatch =
    !user && providedEmail.length > 0 && providedEmail === quote.buyerEmail.toLowerCase();
  if (!isOwner && !guestMatch && user?.role !== "ADMIN") {
    return NextResponse.json(
      { error: "You are not allowed to check out this quote." },
      { status: 401 }
    );
  }

  if (user && user.role !== "ADMIN" && !user.emailVerified) {
    return NextResponse.json({ error: "Verify your email before completing checkout. Request a new verification link from /account.", code: "EMAIL_NOT_VERIFIED" }, { status: 403 });
  }

  if (quote.status !== "ACCEPTED" || quote.quotedUnitCents == null) {
    return NextResponse.json(
      { error: "Accept the quote first." },
      { status: 400 }
    );
  }

  if (quote.quoteExpiresAt && quote.quoteExpiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "This quote has expired. Ask the supplier to re-quote." }, { status: 410 });
  }

  // Shipping inputs. Required to compute freight and to seed Order.shipTo.
  // The full address is collected here (not in Stripe Checkout) so the
  // freight quote is exact; Stripe Checkout still re-collects the
  // shipping address for Stripe Tax (collectShipping: true).
  const shipping = {
    name: String(body.shipping?.name || "").trim(),
    company: String(body.shipping?.company || "").trim(),
    line1: String(body.shipping?.line1 || "").trim(),
    line2: String(body.shipping?.line2 || "").trim(),
    city: String(body.shipping?.city || "").trim(),
    region: String(body.shipping?.region || "").trim(),
    postalCode: String(body.shipping?.postalCode || "").trim(),
  };
  if (
    !shipping.name ||
    !shipping.line1 ||
    !shipping.city ||
    !shipping.region ||
    !/^\d{5}/.test(shipping.postalCode)
  ) {
    return NextResponse.json(
      {
        error:
          "A complete US shipping address is required (name, line 1, city, state, 5-digit ZIP).",
      },
      { status: 400 }
    );
  }

  // Server-trusted freight. Re-quote via Shippo using the supplier's
  // default warehouse; fall back to the flat-rate calculator when
  // Shippo isn't configured or product dims are missing.
  const product = quote.product;
  const warehouse =
    product.supplier.warehouses.find((w) => w.isDefault) ||
    product.supplier.warehouses[0];
  let freightCents = 0;
  let freightCarrier: string | null = null;
  let freightService: string | null = null;
  if (
    isShippoConfigured() &&
    warehouse?.zip &&
    product.weightLbs != null &&
    product.lengthIn != null &&
    product.widthIn != null &&
    product.heightIn != null
  ) {
    const rates = await getFreightRates({
      originZip: warehouse.zip,
      destZip: shipping.postalCode,
      items: [
        {
          qty: quote.qty,
          weightLbs: product.weightLbs,
          lengthIn: product.lengthIn,
          widthIn: product.widthIn,
          heightIn: product.heightIn,
        },
      ],
    });
    const best = rates[0];
    if (best) {
      freightCents = best.cents;
      freightCarrier = best.carrier;
      freightService = best.service;
    }
  }
  if (freightCents === 0) {
    // Flat-rate fallback. Keeps the buyer moving instead of returning a
    // hard error when Shippo can't price this lane.
    const fallback = calculateFreight({
      items: [{ qty: quote.qty }],
      subtotalCents: quote.quotedUnitCents * quote.qty,
    });
    freightCents = fallback.freightCents;
  }

  const subtotalCents = quote.quotedUnitCents * quote.qty;
  const feeCents = feeFor(subtotalCents);
  // Tax stays at 0 here; Stripe Tax fills it in via the webhook +
  // markOrderPaid taxSnapshot path. The buyer sees the real tax on the
  // Stripe Checkout page before paying.
  const totalCentsEstimate = subtotalCents + freightCents + feeCents;

  const shipTo = [
    shipping.name,
    shipping.company,
    shipping.line1,
    shipping.line2,
    `${shipping.city}, ${shipping.region} ${shipping.postalCode}`,
  ]
    .filter(Boolean)
    .join("\n");

  // Reuse the existing PENDING order if a previous attempt already
  // created one. Prevents duplicate orders when the buyer hits Pay
  // twice (H2 spirit; H3 hardens with the unique orderId index).
  let order =
    (quote.orderId
      ? await prisma.order.findUnique({ where: { id: quote.orderId } })
      : null) || null;

  if (order && order.status !== "PENDING") {
    return NextResponse.json(
      { error: "An order already exists for this quote.", orderId: order.id },
      { status: 409 }
    );
  }

  if (!order) {
    // H2: create order + bind quote.orderId in one transaction. On
    // P2002 (the orderId unique index), another concurrent writer beat
    // us; re-read the quote and return that order. Idempotent 200.
    try {
      order = await prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            reference: generateReference(),
            status: "PENDING",
            buyerId: quote.buyerId,
            buyerName: quote.buyerName,
            buyerEmail: quote.buyerEmail,
            buyerCompanyName: user?.companyName || null,
            buyerCompanyLogoUrl: user?.companyLogoUrl || null,
            shipTo,
            subtotalCents,
            freightCents,
            feeCents,
            taxCents: 0,
            totalCents: totalCentsEstimate,
            feeRateBps: effectiveBps(subtotalCents),
            freightCarrier,
            freightService,
            items: {
              create: [
                {
                  productId: quote.productId,
                  nameSnapshot: product.name,
                  skuSnapshot: product.sku,
                  supplierName: product.supplier.name,
                  unitPriceCents: quote.quotedUnitCents!,
                  qty: quote.qty,
                },
              ],
            },
          },
        });
        await tx.quoteRequest.update({
          where: { id: quote.id },
          data: { orderId: created.id },
        });
        return created;
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") {
        const reread = await prisma.quoteRequest.findUnique({
          where: { id: quote.id },
        });
        const winner =
          reread?.orderId
            ? await prisma.order.findUnique({ where: { id: reread.orderId } })
            : null;
        if (winner) {
          return NextResponse.json({ ok: true, orderId: winner.id });
        }
      }
      throw err;
    }
  } else {
    // Refresh totals + ship-to from the latest form submission.
    await prisma.order.update({
      where: { id: order.id },
      data: {
        shipTo,
        subtotalCents,
        freightCents,
        feeCents,
        totalCents: totalCentsEstimate,
        freightCarrier,
        freightService,
      },
    });
  }

  // Hand off to Stripe Checkout via the same provider used by the cart
  // checkout. Itemized lines + collectShipping + automatic_tax flow
  // mirror the cart path.
  const provider = getProvider();
  if (!provider) {
    // Payments not configured: leave the order PENDING; the buyer can
    // pay via whatever fallback the deploy supports.
    return NextResponse.json({ ok: true, orderId: order.id });
  }
  const { isExempt: taxExempt } = await lookupTaxExemption(quote.buyerId);
  const lines: CheckoutLineItem[] = [
    {
      name: product.name,
      unitAmountCents: quote.quotedUnitCents,
      quantity: quote.qty,
    },
  ];
  if (freightCents > 0) {
    lines.push({
      name: "Shipping & handling",
      unitAmountCents: freightCents,
      quantity: 1,
      taxCode: "txcd_92010001",
    });
  }
  if (feeCents > 0) {
    lines.push({
      name: "PartsPort marketplace fee",
      unitAmountCents: feeCents,
      quantity: 1,
      taxCode: "txcd_10000000",
    });
  }
  try {
    const session = await provider.createCheckoutSession({
      orderId: order.id,
      reference: order.reference,
      amountCents: totalCentsEstimate,
      buyerEmail: order.buyerEmail,
      description: `Quote ${quote.reference}: ${quote.qty} x ${product.name}`.slice(0, 480),
      items: lines,
      collectShipping: true,
      taxExempt,
    });
    return NextResponse.json({ ok: true, url: session.url, orderId: order.id });
  } catch (err) {
    captureError(err, { subsystem: "payments", op: "checkout-from-quote", quoteId: quote.id });
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 502 }
    );
  }
}

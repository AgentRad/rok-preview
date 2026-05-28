import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getProvider, type CheckoutLineItem } from "@/lib/payments";
import { feeFor } from "@/lib/money";
import { lookupTaxExemption } from "@/lib/stripe-tax";
import { captureError } from "@/lib/observability";
import {
  getActiveBuyerOrgContext,
  canChargeOrgCard,
} from "@/lib/buyer-org-access";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const provider = getProvider();
  if (!provider) {
    return NextResponse.json(
      { error: "Payments are not configured on this environment." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId || "").trim();
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, buyer: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (order.status !== "PENDING") {
    return NextResponse.json(
      { error: "This order is not awaiting payment." },
      { status: 400 }
    );
  }

  // Tax-exemption check: if the buyer has any APPROVED tax-exempt cert on
  // a saved address, skip Stripe Tax computation entirely. Buyer-wide for
  // now; tighten to per-shipping-address once Order.shippingAddressId
  // exists. See src/lib/stripe-tax.ts for the full flow doc.
  const { isExempt: taxExempt } = await lookupTaxExemption(order.buyerId);

  // PLH-3y-2: HYBRID billing. When the buyer asks to charge the org card and
  // their active org is HYBRID with a Stripe Customer, and the member is
  // permitted, attach the org customer to the Checkout Session. Falls back to
  // member-pays silently if any condition is unmet (never blocks checkout).
  let stripeCustomerId: string | undefined;
  if (body.chargeOrgCard && order.buyer) {
    const ctx = await getActiveBuyerOrgContext(order.buyer);
    if (
      ctx &&
      ctx.org.billingMode === "HYBRID" &&
      ctx.org.stripeCustomerId &&
      canChargeOrgCard(ctx.role)
    ) {
      stripeCustomerId = ctx.org.stripeCustomerId;
    }
  }

  // Itemize the line items so Stripe Tax can compute per-jurisdiction.
  // The platform fee is charged as a separate line so it shows up on the
  // Stripe receipt and so Stripe can tax-code it differently if needed.
  const productLines = order.items.map((i) => ({
    name: i.nameSnapshot,
    unitAmountCents: i.unitPriceCents,
    quantity: i.qty,
  }));
  const feeAmount = order.feeCents > 0 ? order.feeCents : feeFor(order.subtotalCents);
  const lines: CheckoutLineItem[] = [...productLines];
  if (order.freightCents > 0) {
    lines.push({
      name: "Shipping & handling",
      unitAmountCents: order.freightCents,
      quantity: 1,
      // Freight is taxable in most US jurisdictions; let Stripe Tax decide
      // based on the ship-to state. Default goods code is fine.
      taxCode: "txcd_92010001",
    });
  }
  if (feeAmount > 0) {
    lines.push({
      name: "PartsPort marketplace fee",
      unitAmountCents: feeAmount,
      quantity: 1,
      // Service fees use the SaaS tax code; tweak per CPA guidance.
      taxCode: "txcd_10000000",
    });
  }
  const allLines = lines;

  try {
    const session = await provider.createCheckoutSession({
      orderId: order.id,
      reference: order.reference,
      amountCents: order.totalCents,
      buyerEmail: order.buyerEmail,
      description: order.items
        .map((i) => `${i.qty} x ${i.nameSnapshot}`)
        .join(", ")
        .slice(0, 480),
      items: allLines,
      collectShipping: true,
      taxExempt,
      stripeCustomerId,
    });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (err) {
    captureError(err, { subsystem: "payments", op: "create-session" });
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 502 }
    );
  }
}

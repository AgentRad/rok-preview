import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/payments";
import { feeFor } from "@/lib/money";

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
  // a saved address, skip Stripe Tax computation entirely. We do not gate on
  // which address they actually chose for this order yet (no address linkage
  // on Order today); the flag is the buyer-wide signal. Tighten in a follow-up
  // once Order.shippingAddressId exists.
  let taxExempt = false;
  if (order.buyerId) {
    const exemptCert = await prisma.address.findFirst({
      where: { userId: order.buyerId, taxExemptStatus: "APPROVED" },
    });
    taxExempt = !!exemptCert;
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
  const allLines =
    feeAmount > 0
      ? [
          ...productLines,
          {
            name: "PartsPort marketplace fee",
            unitAmountCents: feeAmount,
            quantity: 1,
            // Service fees use the SaaS tax code; tweak per CPA guidance.
            taxCode: "txcd_10000000",
          },
        ]
      : productLines;

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
    });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("[payments] create-session failed:", err);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 502 }
    );
  }
}

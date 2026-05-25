import { NextResponse, after } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateReference } from "@/lib/order-utils";
import { computeOrderTotals } from "@/lib/order-totals";
import { sendOrderConfirmation } from "@/lib/email";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { captureError } from "@/lib/observability";
import {
  surchargeCents,
  type FreightShipment,
  type FreightSurcharges,
} from "@/lib/freight";

export async function POST(req: Request) {
  // Role gate: OEMs and Suppliers cannot place orders. Core platform rule:
  // OEMs participate free with storefront + demand visibility, and every
  // sale routes to their authorized distributors. Suppliers fulfill, they
  // don't buy through their own dashboard. Buyers and anonymous users are
  // the only roles that can POST here.
  const sessionUser = await getCurrentUser();
  if (sessionUser?.role === "MANUFACTURER") {
    return NextResponse.json(
      {
        error:
          "Manufacturers don't purchase through PartsPort. Orders route to your authorized distributors, with no channel conflict. Sign in as a buyer account if you need to test the buy flow.",
      },
      { status: 403 }
    );
  }
  if (sessionUser?.role === "SUPPLIER") {
    return NextResponse.json(
      {
        error:
          "Suppliers fulfill orders, they don't place them. Sign in as a buyer account if you need to test the buy flow.",
      },
      { status: 403 }
    );
  }
  // Bot-throttle: 10 orders per hour per user (or per IP for guests).
  // Legitimate buyers never hit this; credential-stuffing bots that get a
  // session token would.
  const rlKey = sessionUser ? `user:${sessionUser.id}` : `ip:${clientIp(req)}`;
  const orderLimit = await rateLimit("order", rlKey);
  if (!orderLimit.allowed) {
    return NextResponse.json(
      {
        error:
          "You've hit the order rate limit for now. Try again in an hour, or contact support if you need to place many orders quickly.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(orderLimit.retryAfterMs / 1000)),
        },
      }
    );
  }

  // Signed-in buyers must verify their email before placing orders. Guest
  // checkout (no session) is still allowed; the order email + invoice land
  // at whatever address they typed. The fraud risk for an unverified
  // signed-in buyer is higher than a guest because account abuse can
  // unlock saved addresses / reorders / reviews; verification gates those.
  if (sessionUser && !sessionUser.emailVerified) {
    return NextResponse.json(
      {
        error:
          "Verify your email before placing orders. Check your inbox for the welcome email, or request a new verification link from /account.",
        code: "EMAIL_NOT_VERIFIED",
      },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const items: { sku: string; qty: number }[] = Array.isArray(body.items)
    ? body.items
    : [];
  const buyerName = String(body.buyerName || "").trim();
  const buyerEmail = String(body.buyerEmail || "").toLowerCase().trim();
  const shipTo = String(body.shipTo || "").trim();

  if (!buyerName || !buyerEmail || !shipTo) {
    return NextResponse.json(
      { error: "Name, email and delivery address are required." },
      { status: 400 }
    );
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
  }

  const products = await prisma.product.findMany({
    where: { sku: { in: items.map((i) => String(i.sku)) }, active: true },
    include: { supplier: true },
  });
  const bySku = new Map(products.map((p) => [p.sku, p]));

  const orderItems = [];
  const lines = [];
  for (const it of items) {
    const p = bySku.get(String(it.sku));
    const qty = Math.max(1, Math.floor(Number(it.qty) || 0));
    if (!p) continue;
    orderItems.push({
      productId: p.id,
      nameSnapshot: p.name,
      skuSnapshot: p.sku,
      supplierName: p.supplier.name,
      unitPriceCents: p.priceCents,
      qty,
    });
    lines.push({
      unitPriceCents: p.priceCents,
      qty,
      quoteOnly: p.quoteOnly,
    });
  }
  if (orderItems.length === 0) {
    return NextResponse.json(
      { error: "None of the cart items are available." },
      { status: 400 }
    );
  }

  // P9: optional freight selection from the checkout client. When the
  // buyer picks a real-rate quote we honor it; otherwise computeOrderTotals
  // falls back to the deterministic flat-rate calculator.
  //
  //   freightBreakdown: per-supplier shipment array (multi-supplier orders)
  //   freightCarrier / freightService: top-level labels for the chosen rate
  //   freightSurcharges: { liftgate, residential, insideDelivery } booleans
  let freightOverrideCents: number | undefined;
  let freightOverrideLabel: string | undefined;
  let freightBreakdown: FreightShipment[] = [];
  if (Array.isArray(body.freightBreakdown) && body.freightBreakdown.length > 0) {
    const parsed: FreightShipment[] = body.freightBreakdown
      .map((s: Record<string, unknown>) => ({
        supplierId: String(s.supplierId || ""),
        supplierName: String(s.supplierName || ""),
        originZip: String(s.originZip || ""),
        carrier: String(s.carrier || "Carrier"),
        service: String(s.service || "Standard"),
        cents: Math.max(0, Math.floor(Number(s.cents) || 0)),
        etaDays:
          typeof s.etaDays === "number" && Number.isFinite(s.etaDays)
            ? s.etaDays
            : null,
      }))
      .filter((s: FreightShipment) => !!s.supplierId);
    freightBreakdown = parsed;
    freightOverrideCents = parsed.reduce((sum, s) => sum + s.cents, 0);
    freightOverrideLabel =
      parsed.length === 1
        ? `${parsed[0].carrier} ${parsed[0].service}`
        : `${parsed.length} shipments`;
  } else if (
    typeof body.freightCents === "number" &&
    Number.isFinite(body.freightCents) &&
    body.freightCents >= 0
  ) {
    freightOverrideCents = Math.floor(body.freightCents);
    freightOverrideLabel = String(body.freightLabel || "Selected freight");
  }

  const surcharges: FreightSurcharges = {
    liftgate: !!body.freightSurcharges?.liftgate,
    residential: !!body.freightSurcharges?.residential,
    insideDelivery: !!body.freightSurcharges?.insideDelivery,
  };
  const surchargeAdd = surchargeCents(surcharges);
  if (freightOverrideCents != null) {
    freightOverrideCents += surchargeAdd;
  }

  const freightCarrier =
    typeof body.freightCarrier === "string" && body.freightCarrier.trim()
      ? body.freightCarrier.trim().slice(0, 80)
      : null;
  const freightService =
    typeof body.freightService === "string" && body.freightService.trim()
      ? body.freightService.trim().slice(0, 80)
      : null;

  // Single source of truth for the order math. See src/lib/order-totals.ts.
  // Tax stays 0 here; Stripe Tax snapshots it back in markOrderPaid.
  const totals = computeOrderTotals(lines, {
    freightOverrideCents,
    freightOverrideLabel,
  });
  // Reuse the session lookup we already did up top for the role gate; no
  // need for a second auth round-trip.
  const user = sessionUser;

  const order = await prisma.order.create({
    data: {
      reference: generateReference(),
      status: "PENDING",
      buyerId: user?.id ?? null,
      buyerName,
      buyerEmail,
      // Snapshot the buyer's company branding onto the Order so future
      // profile edits don't retroactively rewrite this invoice. Guest
      // checkout has no user, so these stay null and the invoice falls
      // back to no-logo rendering.
      buyerCompanyName: user?.companyName ?? null,
      buyerCompanyLogoUrl: user?.companyLogoUrl ?? null,
      shipTo,
      subtotalCents: totals.subtotalCents,
      freightCents: totals.freightCents,
      feeCents: totals.feeCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      feeRateBps: totals.feeRateBps,
      // P9 freight columns. carrier/service are top-level labels (the
      // shipping-confirmation email reads these); breakdown is the per-
      // shipment detail (used by the order-detail page when the cart
      // spans multiple suppliers); surcharges is the persisted flag set.
      freightCarrier,
      freightService,
      freightBreakdown:
        freightBreakdown.length > 0
          ? (freightBreakdown as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      freightSurcharges:
        surchargeAdd > 0
          ? (surcharges as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      items: { create: orderItems },
    },
    include: { items: true },
  });

  // Next 15 `after()` keeps the serverless function alive until the email
  // actually sends, so a Vercel cold-start kill can't drop it. Replaces
  // the previous fire-and-forget `.catch(...)` which broke on serverless.
  after(async () => {
    try {
      await sendOrderConfirmation(order);
    } catch (err) {
      captureError(err, { subsystem: "email", op: "order-confirmation", orderId: order.id });
    }
  });

  return NextResponse.json({
    ok: true,
    orderId: order.id,
    reference: order.reference,
    subtotalCents: totals.subtotalCents,
    freightCents: totals.freightCents,
    feeCents: totals.feeCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
  });
}

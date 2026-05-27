import { NextResponse, after } from "next/server";
import crypto from "node:crypto";
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
import { getFreightRates } from "@/lib/freight-server";

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

  // P9.5 CRIT 8: server-side idempotency. Hash a client-supplied key
  // (Idempotency-Key header or body.idempotencyKey) with the buyer
  // identifier so two different buyers can use the same key without
  // colliding. A repeat POST short-circuits to the existing order.
  const rawIdempotency =
    req.headers.get("idempotency-key") ||
    (typeof body.idempotencyKey === "string" ? body.idempotencyKey : "");
  let idempotencyKey: string | null = null;
  if (rawIdempotency) {
    const buyerScope = sessionUser?.id || buyerEmail;
    idempotencyKey = crypto
      .createHash("sha256")
      .update(`${rawIdempotency}|${buyerScope}`)
      .digest("hex");
    const existing = await prisma.order.findUnique({
      where: { idempotencyKey },
      select: {
        id: true,
        reference: true,
        subtotalCents: true,
        freightCents: true,
        feeCents: true,
        taxCents: true,
        totalCents: true,
      },
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        orderId: existing.id,
        reference: existing.reference,
        subtotalCents: existing.subtotalCents,
        freightCents: existing.freightCents,
        feeCents: existing.feeCents,
        taxCents: existing.taxCents,
        totalCents: existing.totalCents,
        idempotent: true,
      });
    }
  }

  // Bot-throttle: 10 orders per hour per user (or per IP for guests).
  // Runs AFTER the idempotency lookup so a retrying client whose first
  // POST succeeded gets the cached order back, not a 429. Only counts
  // against the limit when we're about to actually create a new order.
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

  // PLH-1 commit 3: block orders for suspended or hidden suppliers. A
  // product row may still be marked active while the parent supplier is
  // suspended / hidden during onboarding, so we filter at the supplier
  // join instead of relying on Product.active alone.
  const requestedSkus = items.map((i) => String(i.sku));
  const products = await prisma.product.findMany({
    where: {
      sku: { in: requestedSkus },
      active: true,
      supplier: { is: { status: "APPROVED", publicVisible: true } },
    },
    include: { supplier: true },
  });
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const unavailableSkus = requestedSkus.filter((s) => !bySku.has(s));
  if (unavailableSkus.length > 0) {
    return NextResponse.json(
      {
        error:
          "One or more items are no longer available. Remove them from your cart and try again.",
        unavailableSkus,
      },
      { status: 400 }
    );
  }

  // PLH-3g Phase 2: multi-supplier carts are allowed in the UI, but the
  // Order model is still single-supplier in this phase. Phase 3 will
  // partition placement into per-supplier OrderSupplierSlot rows; until
  // then, freight/fee math assumes a single supplier and would misprice
  // a multi-supplier cart. To keep the platform safe between phases, the
  // server-side placement gate stays: a multi-supplier cart returns 503
  // and cannot be placed in production until Phase 3 lands. Phase 4 will
  // wire per-supplier freight + payment-intent splits via Stripe Connect
  // destination charges.
  const supplierIds = new Set(products.map((p) => p.supplierId));
  if (supplierIds.size > 1) {
    return NextResponse.json(
      {
        error:
          "Multi-supplier checkout coming soon. For now, please place one order per supplier.",
        code: "MULTI_SUPPLIER_CHECKOUT_PENDING",
      },
      { status: 503 }
    );
  }

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

  // P9.5 CRIT 2: server re-quotes freight via getFreightRates and only
  // accepts client-supplied freight cents that match a rate Stripe / Shippo
  // actually returned. Pre-P9.5 the route trusted body.freightBreakdown[].cents
  // blindly, so a buyer could submit cents:0 and pay no freight.
  //
  // Strategy:
  //   1. Parse a destination ZIP out of shipTo (best effort regex).
  //   2. For each supplier slot the client supplied (with rateId), re-quote
  //      from the supplier's default warehouse to the dest ZIP.
  //   3. Accept the slot's cents ONLY if the server-returned rate with the
  //      same rateId has the same cents (or rateId matches at all).
  //   4. If no rateId matches OR Shippo is unconfigured, fall through to
  //      computeOrderTotals which runs the deterministic flat-rate path.
  //
  // P9.5 CRIT 3: surcharges always added to freight + always persisted
  // regardless of whether freight quote was selected.
  const submittedBreakdown: Array<{
    supplierId: string;
    supplierName: string;
    originZip: string;
    carrier: string;
    service: string;
    cents: number;
    rateId: string | null;
    etaDays: number | null;
  }> = Array.isArray(body.freightBreakdown)
    ? body.freightBreakdown
        .map((s: Record<string, unknown>) => ({
          supplierId: String(s.supplierId || ""),
          supplierName: String(s.supplierName || ""),
          originZip: String(s.originZip || ""),
          carrier: String(s.carrier || "Carrier"),
          service: String(s.service || "Standard"),
          cents: Math.max(0, Math.floor(Number(s.cents) || 0)),
          rateId:
            typeof s.rateId === "string" && s.rateId ? s.rateId : null,
          etaDays:
            typeof s.etaDays === "number" && Number.isFinite(s.etaDays)
              ? s.etaDays
              : null,
        }))
        .filter((s: { supplierId: string }) => !!s.supplierId)
    : [];

  let freightOverrideCents: number | undefined;
  let freightOverrideLabel: string | undefined;
  let freightBreakdown: FreightShipment[] = [];
  if (submittedBreakdown.length > 0) {
    // Extract the destination ZIP for the server re-quote.
    const zipMatch = shipTo.match(/\b(\d{5})(?:-\d{4})?\b/);
    const destZip = zipMatch?.[1] || "";

    // Re-quote each supplier-shipment against the live Shippo API. If a
    // slot's rateId matches a server-returned rate, take the server's
    // cents (not the client's). If no match, drop that slot back to the
    // flat-rate path.
    const verified: FreightShipment[] = [];
    for (const slot of submittedBreakdown) {
      // Pull the supplier's items + dims out of the order line set the
      // server already validated above.
      const slotItems = orderItems
        .filter((it) => {
          const p = bySku.get(it.skuSnapshot);
          return p && p.supplierId === slot.supplierId;
        })
        .map((it) => {
          const p = bySku.get(it.skuSnapshot)!;
          return {
            qty: it.qty,
            weightLbs: p.weightLbs,
            lengthIn: p.lengthIn,
            widthIn: p.widthIn,
            heightIn: p.heightIn,
          };
        });

      let serverCents = -1;
      let serverCarrier = slot.carrier;
      let serverService = slot.service;
      let serverEta = slot.etaDays;
      if (destZip && slot.originZip && slot.rateId) {
        try {
          const rates = await getFreightRates({
            originZip: slot.originZip,
            destZip,
            items: slotItems,
          });
          const match = rates.find((r) => r.rateId === slot.rateId);
          if (match) {
            serverCents = match.cents;
            serverCarrier = match.carrier;
            serverService = match.service;
            serverEta = match.etaDays;
          }
        } catch (err) {
          captureError(err, {
            subsystem: "freight",
            op: "order-requote",
            supplierId: slot.supplierId,
          });
        }
      }
      if (serverCents >= 0) {
        verified.push({
          supplierId: slot.supplierId,
          supplierName: slot.supplierName,
          originZip: slot.originZip,
          carrier: serverCarrier,
          service: serverService,
          cents: serverCents,
          etaDays: serverEta,
        });
      }
      // Slots that didn't match a server rate are dropped from the
      // override and the flat-rate fallback supplies their freight.
    }
    if (verified.length === submittedBreakdown.length && verified.length > 0) {
      // Every slot matched a server quote: use the verified totals.
      freightBreakdown = verified;
      freightOverrideCents = verified.reduce((sum, s) => sum + s.cents, 0);
      freightOverrideLabel =
        verified.length === 1
          ? `${verified[0].carrier} ${verified[0].service}`
          : `${verified.length} shipments`;
    }
    // Partial matches fall through to the deterministic flat-rate so the
    // buyer doesn't get a half-trusted total.
  } else if (
    typeof body.freightCents === "number" &&
    Number.isFinite(body.freightCents) &&
    body.freightCents >= 0
  ) {
    // No breakdown, but client submitted a flat cents number. We ignore
    // this entirely now (the only legitimate source of trusted freight
    // cents is the server re-quote path above). Comment retained for
    // forward callers; falling through to flat-rate is the safe default.
  }

  const surcharges: FreightSurcharges = {
    liftgate: !!body.freightSurcharges?.liftgate,
    residential: !!body.freightSurcharges?.residential,
    insideDelivery: !!body.freightSurcharges?.insideDelivery,
  };
  const surchargeAdd = surchargeCents(surcharges);
  // CRIT 3: surcharges always add to freight cents, regardless of whether
  // the buyer selected a real-rate quote. Pre-P9.5 they were silently
  // dropped when no quote was selected.
  if (surchargeAdd > 0) {
    if (freightOverrideCents == null) {
      // No real-rate override: compute the flat-rate fallback first, then
      // add the surcharges so the total is honest.
      const fallbackTotals = computeOrderTotals(lines);
      freightOverrideCents = fallbackTotals.freightCents + surchargeAdd;
      freightOverrideLabel = `${fallbackTotals.freight.label}, +surcharges`;
    } else {
      freightOverrideCents += surchargeAdd;
    }
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
      idempotencyKey,
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
        // CRIT 3: persist the surcharge flag set whenever ANY flag is
        // true. Pre-P9.5 we only persisted when surchargeAdd > 0 AND a
        // real-rate quote was selected, dropping the flags entirely on
        // flat-rate orders even when the buyer ticked Liftgate.
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

import { NextResponse, after } from "next/server";
import crypto from "node:crypto";
import { Prisma, type PaymentTerms } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generateReference, ensureNetTermsInvoiceForOrder } from "@/lib/order-utils";
import { computeOrderTotals, computePerSupplierSlots } from "@/lib/order-totals";
import { sendOrderConfirmation } from "@/lib/email";
import { getActiveBuyerOrgContext } from "@/lib/buyer-org-access";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { captureError } from "@/lib/observability";
import { writeAuditLog } from "@/lib/audit";
import { evaluateAndApplyApproval } from "@/lib/approval";
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
  // PLH-3w P1: a suspended/banned buyer cannot place orders. Suspension
  // already kills the session cookie (sessionsValidFrom bump), so this is
  // a defensive belt for any session that somehow survives.
  if (sessionUser && sessionUser.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "This account is not available. Contact support@partsport.com." },
      { status: 403 }
    );
  }
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
  // PLH-3z-4: org-level credit suspension. A member of a SUSPENDED org (30-day
  // past-due net-terms balance) cannot place new orders until the balance
  // clears. 423 Locked. Non-org buyers and ACTIVE orgs are unaffected.
  if (sessionUser) {
    const orgForGate = await getActiveBuyerOrgContext(sessionUser);
    if (orgForGate && orgForGate.org.status === "SUSPENDED") {
      return NextResponse.json(
        {
          error:
            "Your organization's account is suspended for a past-due balance. Contact your accounts-payable team or support@partsport.agentgaming.gg to clear it.",
          code: "ORG_SUSPENDED",
        },
        { status: 423 }
      );
    }
  }

  const body = await req.json().catch(() => ({}));
  const items: { sku: string; qty: number }[] = Array.isArray(body.items)
    ? body.items
    : [];
  const buyerName = String(body.buyerName || "").trim();
  const buyerEmail = String(body.buyerEmail || "").toLowerCase().trim();
  const shipTo = String(body.shipTo || "").trim();
  // PLH-3v: optional buyer-supplied PO number. Trim + cap at 64 chars
  // to match the indexed Order.purchaseOrderNumber column.
  const purchaseOrderNumberRaw = String(body.purchaseOrderNumber || "").trim();
  const purchaseOrderNumber = purchaseOrderNumberRaw
    ? purchaseOrderNumberRaw.slice(0, 64)
    : null;

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

  // PLH-3g Phase 3: multi-supplier carts are now placeable. Each Order
  // gets one OrderSupplierSlot per distinct supplier, carrying that
  // supplier's slice of subtotal, freight, and fee. The Order row's
  // totals are the sum across slots. Phase 4 will wire per-supplier
  // payment-intent splits via Stripe Connect destination charges; until
  // then the order settles as a single charge but the slot rows let
  // refund + payout code iterate per supplier uniformly.

  type OrderItemInput = {
    productId: string;
    nameSnapshot: string;
    skuSnapshot: string;
    supplierName: string;
    unitPriceCents: number;
    qty: number;
  };
  const orderItems: OrderItemInput[] = [];
  const lines: { unitPriceCents: number; qty: number; quoteOnly: boolean }[] = [];
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

  // Map supplierId -> server-verified freight cents (from Shippo re-quote).
  // Only populated for slots whose client-supplied rateId matches a live
  // server-returned rate. Slots without a verified entry fall back to the
  // deterministic per-supplier flat-rate calculator below.
  const verifiedFreightBySupplier = new Map<
    string,
    { cents: number; carrier: string; service: string; etaDays: number | null; originZip: string; supplierName: string }
  >();
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
        verifiedFreightBySupplier.set(slot.supplierId, {
          cents: serverCents,
          carrier: serverCarrier,
          service: serverService,
          etaDays: serverEta,
          originZip: slot.originZip,
          supplierName: slot.supplierName,
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

  // PLH-3g Phase 3: per-supplier slot math. Group order items by
  // supplierId, compute slot subtotal + freight + fee, and verify they
  // sum to the Order totals computed above. Slot freight uses the
  // server-verified Shippo cents when a matched shipment exists, else
  // the deterministic flat-rate calculator on JUST that supplier's
  // lines. Slot fee is 6% of the slot's own subtotal.
  // PLH-3g P9: slot math extracted into computePerSupplierSlots so
  // /api/orders and Vitest can share the same code path.
  const slotLinesInput = orderItems
    .map((it) => {
      const p = bySku.get(it.skuSnapshot);
      if (!p) return null;
      return {
        supplierId: p.supplierId,
        unitPriceCents: it.unitPriceCents,
        qty: it.qty,
        quoteOnly: p.quoteOnly,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const verifiedCentsBySupplier = new Map<string, number>();
  for (const [sid, v] of verifiedFreightBySupplier) {
    verifiedCentsBySupplier.set(sid, v.cents);
  }
  const slots = computePerSupplierSlots(slotLinesInput, {
    verifiedFreightBySupplier: verifiedCentsBySupplier,
    surchargeCents: surchargeAdd,
  });

  // The server-verified per-supplier freight is the source of truth. Each
  // slot carries either the matched Shippo re-quote cents or the
  // deterministic per-supplier flat-ground fallback, plus any pro-rata
  // surcharge distributed by computePerSupplierSlots. For a multi-supplier
  // cart the real order freight is the SUM of those slots, which typically
  // exceeds the order-level combined-shipment estimate in `totals.freightCents`
  // (one combined flat quote is cheaper than N per-supplier shipments). We
  // adopt the slot sum as the order freight so the Order row and its slots
  // agree by construction, and the old combined-cart estimate can no longer
  // disagree with the slots and trip a 500. This mirrors how orderFeeCents
  // already adopts the sum-of-slot fees below. The checkout client computes
  // and displays this same per-supplier sum, so the buyer always sees and
  // agrees to exactly what we charge (see the anti-underpay check below).
  const slotSubtotalSum = slots.reduce((s, x) => s + x.subtotalCents, 0);
  const reconciledFreightCents = slots.reduce((s, x) => s + x.freightCents, 0);
  const slotFeeSum = slots.reduce((s, x) => s + x.feeCents, 0);

  // Server-trust check. If the client posted claimed totals, verify them
  // against the server compute. Mismatch returns 400 so a tampered or stale
  // cart cannot pay less than the real total.
  const claimedSubtotal = Number(body.claimedSubtotalCents);
  const claimedFreight = Number(body.claimedFreightCents);
  const claimedFee = Number(body.claimedFeeCents);
  if (Number.isFinite(claimedSubtotal) && claimedSubtotal !== totals.subtotalCents) {
    return NextResponse.json(
      { error: "Cart subtotal mismatch. Refresh your cart and try again.", code: "SUBTOTAL_MISMATCH" },
      { status: 400 }
    );
  }
  // Anti-underpay: reject only when the client claims LESS freight than the
  // server-verified per-supplier total (a tampered cart, or a stale estimate
  // posted before the live per-supplier rates loaded). A buyer who saw and
  // agreed to the correct (>=) freight passes; we then charge the server
  // amount (reconciledFreightCents), which is <= what they claimed, so the
  // buyer is never charged more than they agreed to. A stale-low claim gets a
  // clear refresh-and-retry 400, never a 500.
  if (Number.isFinite(claimedFreight) && claimedFreight < reconciledFreightCents) {
    return NextResponse.json(
      {
        error:
          "Freight was updated to the live per-supplier rate. Review the new total and try again.",
        code: "FREIGHT_MISMATCH",
      },
      { status: 400 }
    );
  }
  if (Number.isFinite(claimedFee) && claimedFee !== totals.feeCents) {
    return NextResponse.json(
      { error: "Fee mismatch. Refresh your cart and try again.", code: "FEE_MISMATCH" },
      { status: 400 }
    );
  }

  // Sanity belt: the slot subtotals must still sum to the order subtotal
  // exactly (this is a pure partition of the same line items, so any drift
  // is an impossible-state bug worth a 500). Freight is adopted from the
  // slot sum above, so it agrees by construction and cannot drift here. We
  // keep a non-fatal diagnostic when the adopted freight differs from the
  // order-level combined estimate, since that is the normal multi-supplier
  // case (per-supplier shipments cost more than one combined quote) and
  // useful to observe, but it must never 500 the buyer.
  if (slotSubtotalSum !== totals.subtotalCents) {
    captureError(new Error("PLH-3g slot subtotal drift"), {
      subsystem: "orders",
      slotSubtotalSum,
      orderSubtotal: totals.subtotalCents,
    });
    return NextResponse.json(
      { error: "Cart totals could not be reconciled. Please refresh and try again." },
      { status: 500 }
    );
  }
  if (reconciledFreightCents !== totals.freightCents) {
    captureError(new Error("PLH-3g freight reconciled to slot sum"), {
      subsystem: "orders",
      level: "info",
      reconciledFreightCents,
      orderEstimateFreight: totals.freightCents,
      supplierCount: slots.length,
    });
  }
  const orderFeeCents = slotFeeSum;
  const orderTotalCents =
    totals.subtotalCents + reconciledFreightCents + orderFeeCents + totals.taxCents;

  // PLH-3y-6 prerequisite: permanently bind the order to the buyer's active
  // org when they have one, so approvals + org spend-visibility survive the
  // member later leaving the org. Guests and orgless buyers stay null.
  let buyerOrgId: string | null = null;
  // PLH-3z-1: net-terms. Snapshot the active org's payment terms onto the order.
  // PREPAID for non-org buyers and PREPAID orgs keeps the existing Stripe
  // checkout flow exactly as-is. Only a non-PREPAID org turns this into an
  // invoice order with a due date.
  let orderPaymentTerms: PaymentTerms = "PREPAID";
  let invoiceDueDate: Date | null = null;
  if (user) {
    const orgCtx = await getActiveBuyerOrgContext(user);
    buyerOrgId = orgCtx?.org.id ?? null;
    if (orgCtx && orgCtx.org.paymentTerms !== "PREPAID") {
      orderPaymentTerms = orgCtx.org.paymentTerms;
      const days =
        orderPaymentTerms === "NET_15" ? 15 : orderPaymentTerms === "NET_60" ? 60 : 30;
      invoiceDueDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
  }
  const isInvoiceOrder = orderPaymentTerms !== "PREPAID";

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
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
        purchaseOrderNumber,
        buyerOrgId,
        paymentTerms: orderPaymentTerms,
        invoiceDueDate,
        subtotalCents: totals.subtotalCents,
        freightCents: reconciledFreightCents,
        feeCents: orderFeeCents,
        taxCents: totals.taxCents,
        totalCents: orderTotalCents,
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
    for (const slot of slots) {
      await tx.orderSupplierSlot.create({
        data: {
          orderId: created.id,
          supplierId: slot.supplierId,
          subtotalCents: slot.subtotalCents,
          freightCents: slot.freightCents,
          feeCents: slot.feeCents,
        },
      });
    }
    return created;
  });

  // Audit trail. Best-effort; writeAuditLog swallows its own errors so a
  // logging hiccup can't fail a placed order.
  const createdSlots = await prisma.orderSupplierSlot.findMany({
    where: { orderId: order.id },
    select: { id: true, supplierId: true },
  });
  await writeAuditLog({
    actor: { id: user?.id ?? "guest", email: buyerEmail },
    action: "ORDER_CREATED",
    targetType: "Order",
    targetId: order.id,
    summary: `Order ${order.reference} placed across ${slots.length} supplier${slots.length === 1 ? "" : "s"}`,
    metadata: {
      orderId: order.id,
      supplierCount: slots.length,
      slotIds: createdSlots.map((s) => s.id),
    },
  });

  // PLH-3y-6: evaluate approval rules for org buyers. Best-effort: a failure
  // returns NONE so checkout is never blocked by a logging hiccup. PENDING
  // result is surfaced to the client so the UI can redirect to the holding
  // page instead of proceeding directly to Stripe Checkout.
  const approvalStatus = await evaluateAndApplyApproval(order.id);

  // PLH-3z-1: net-terms invoice orders bypass Stripe Checkout entirely. When
  // the order is on net terms AND not waiting on approval, generate the DUE
  // invoice now and email it. PREPAID orders are untouched (no invoice until
  // payment, exactly as before). Approval-pending net orders defer invoice
  // generation until the approval clears (handled when payment would resume).
  if (isInvoiceOrder && approvalStatus !== "PENDING") {
    await ensureNetTermsInvoiceForOrder(order.id);
  }

  // Next 15 `after()` keeps the serverless function alive until the email
  // actually sends, so a Vercel cold-start kill can't drop it. Replaces
  // the previous fire-and-forget `.catch(...)` which broke on serverless.
  after(async () => {
    try {
      // PLH-3g P7: re-fetch with supplierSlots + per-item supplierId so
      // multi-supplier orders render per-supplier sections in the email.
      const fresh = await prisma.order.findUnique({
        where: { id: order.id },
        include: {
          items: { include: { product: { select: { supplierId: true } } } },
          supplierSlots: { include: { supplier: { select: { name: true } } } },
        },
      });
      const lite = fresh
        ? {
            ...fresh,
            supplierSlots: fresh.supplierSlots.map((s) => ({
              id: s.id,
              supplierId: s.supplierId,
              supplierName: s.supplier?.name ?? null,
              subtotalCents: s.subtotalCents,
              freightCents: s.freightCents,
              feeCents: s.feeCents,
              carrier: s.carrier,
              trackingCode: s.trackingCode,
              trackingUrl: s.trackingUrl,
              shipmentStage: s.shipmentStage,
              shippedAt: s.shippedAt,
              deliveredAt: s.deliveredAt,
            })),
          }
        : order;
      await sendOrderConfirmation(lite);
    } catch (err) {
      captureError(err, { subsystem: "email", op: "order-confirmation", orderId: order.id });
    }
  });

  return NextResponse.json({
    ok: true,
    orderId: order.id,
    reference: order.reference,
    subtotalCents: totals.subtotalCents,
    freightCents: reconciledFreightCents,
    feeCents: orderFeeCents,
    taxCents: totals.taxCents,
    totalCents: orderTotalCents,
    supplierCount: slots.length,
    approvalStatus,
    // Convenience flag: true when the order is now in the approval queue
    // and the client should redirect to /orders/[id]?pending-approval=1
    // rather than proceeding to Stripe Checkout.
    pendingApproval: approvalStatus === "PENDING",
    // PLH-3z-1: true when the order is billed on net terms (invoice, no Stripe
    // Checkout). The client redirects to the order page instead of payment.
    invoiceOrder: isInvoiceOrder,
    paymentTerms: orderPaymentTerms,
  });
}

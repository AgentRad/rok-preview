import { NextResponse } from "next/server";
import { Shippo } from "shippo";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { captureError } from "@/lib/observability";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

let _client: Shippo | null = null;
function client(): Shippo | null {
  if (_client) return _client;
  if (!process.env.SHIPPO_API_KEY) return null;
  _client = new Shippo({
    apiKeyHeader: process.env.SHIPPO_API_KEY,
    shippoApiVersion: "2018-02-08",
  });
  return _client;
}

/**
 * Best-effort parse of the buyer-typed shipTo block.
 *
 * P9.5 MED 22: when the parser can't extract a real city, we now refuse
 * to print rather than ship "City" placeholder to Shippo. Forces admin
 * to fix the address first or fall back to manual carrier entry.
 */
function parseUsAddress(shipTo: string):
  | {
      ok: true;
      street1: string;
      city: string;
      state: string;
      zip: string;
      country: string;
    }
  | { ok: false; reason: string } {
  const zipMatch = shipTo.match(/\b(\d{5})(-\d{4})?\b/);
  if (!zipMatch) {
    return { ok: false, reason: "Could not find a 5-digit ZIP in the delivery address." };
  }
  const stateMatch = shipTo.match(/\b([A-Z]{2})\s+\d{5}/);
  if (!stateMatch) {
    return {
      ok: false,
      reason:
        "Could not find a 2-letter state code before the ZIP. Edit the buyer's address to 'Street, City, ST 12345' format before printing.",
    };
  }
  // Pull the city from the segment immediately before "STATE ZIP".
  // Pattern: "...Street, City, ST 12345"  -> city = "City"
  // If the address has no commas the parser falls back to a directional "Unknown"
  // city which Shippo will reject; we surface a clearer error there.
  const cityMatch = shipTo.match(/,\s*([A-Za-z][A-Za-z .\-']{1,40}),?\s+[A-Z]{2}\s+\d{5}/);
  if (!cityMatch) {
    return {
      ok: false,
      reason:
        "Could not extract a city. Ensure the address has a comma before the city, like 'Street, City, ST 12345'.",
    };
  }
  // Street1: anything before the first comma is the street.
  const firstComma = shipTo.indexOf(",");
  const street1 =
    firstComma > 0
      ? shipTo.slice(0, firstComma).trim().slice(0, 80)
      : shipTo.trim().slice(0, 80);
  return {
    ok: true,
    street1,
    city: cityMatch[1].trim(),
    state: stateMatch[1],
    zip: zipMatch[1],
    country: "US",
  };
}

/**
 * Multi-supplier label printer. Pre-P9.5 this aggregated all items into
 * one parcel from supplier[0]'s warehouse, which is wrong when a cart
 * spans multiple suppliers. P9.5 CRIT 4: group items per supplier, buy
 * one label per shipment, persist all of them on Order.shippoLabels.
 *
 * HIGH 20 idempotency: if Order.shippoLabels is already populated, return
 * the existing labels instead of re-buying. Admin can force a fresh buy
 * via body.reprint = true.
 *
 * MED 28 audit: every successful label purchase writes a LABEL_PURCHASED
 * audit row.
 */
type LabelRecord = {
  supplierId: string;
  supplierName: string;
  labelUrl: string;
  trackingNumber: string | null;
  carrier: string | null;
  service: string | null;
  costCents: number;
  transactionId: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { id } = await params;
  const s = client();
  if (!s) {
    return NextResponse.json(
      {
        error:
          "Shippo isn't configured on this deployment. Add SHIPPO_API_KEY in Vercel env to enable label printing.",
        configured: false,
      },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const reprint = body?.reprint === true;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: {
            include: {
              supplier: {
                include: {
                  warehouses: {
                    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (order.status !== "PAID" && order.status !== "FULFILLED") {
    return NextResponse.json(
      { error: "Only paid orders can have labels printed." },
      { status: 400 }
    );
  }

  // HIGH 20: idempotent reprint. If labels already exist and admin
  // hasn't asked for a reprint, return the saved set instead of buying
  // again (live Shippo charges per label).
  if (
    !reprint &&
    order.shippoLabels &&
    Array.isArray(order.shippoLabels) &&
    (order.shippoLabels as unknown[]).length > 0
  ) {
    return NextResponse.json({
      ok: true,
      labels: order.shippoLabels,
      reprinted: false,
      cachedFromPriorPrint: true,
    });
  }

  // MED 22: refuse with clear copy if shipTo can't be parsed cleanly.
  const dest = parseUsAddress(order.shipTo);
  if (!dest.ok) {
    return NextResponse.json(
      { error: `Address parse failed: ${dest.reason}` },
      { status: 400 }
    );
  }

  // CRIT 4: group items per supplier, build one shipment per warehouse.
  type Slot = {
    supplierId: string;
    supplierName: string;
    warehouse:
      | { label: string; city: string; state: string; zip: string }
      | null;
    parcel: {
      weightLbs: number;
      lengthIn: number;
      widthIn: number;
      heightIn: number;
    } | null;
    missingDimSku?: string;
  };
  const slotsBySupplier = new Map<string, Slot>();
  for (const item of order.items) {
    const supId = item.product.supplierId;
    if (!slotsBySupplier.has(supId)) {
      const warehouse =
        item.product.supplier.warehouses.find((w) => w.isDefault) ||
        item.product.supplier.warehouses[0] ||
        null;
      slotsBySupplier.set(supId, {
        supplierId: supId,
        supplierName: item.product.supplier.name,
        warehouse: warehouse
          ? {
              label: warehouse.label,
              city: warehouse.city,
              state: warehouse.state,
              zip: warehouse.zip,
            }
          : null,
        parcel: null,
      });
    }
    const slot = slotsBySupplier.get(supId)!;
    const p = item.product;
    if (
      p.weightLbs == null ||
      p.lengthIn == null ||
      p.widthIn == null ||
      p.heightIn == null
    ) {
      slot.missingDimSku = p.sku;
      continue;
    }
    if (!slot.parcel) {
      slot.parcel = {
        weightLbs: 0,
        lengthIn: 0,
        widthIn: 0,
        heightIn: 0,
      };
    }
    slot.parcel.weightLbs += p.weightLbs * item.qty;
    slot.parcel.lengthIn = Math.max(slot.parcel.lengthIn, p.lengthIn);
    slot.parcel.widthIn = Math.max(slot.parcel.widthIn, p.widthIn);
    slot.parcel.heightIn = Math.max(
      slot.parcel.heightIn,
      p.heightIn * Math.min(item.qty, 3)
    );
  }

  // Validate every slot has both a warehouse and a parcel.
  for (const slot of slotsBySupplier.values()) {
    if (!slot.warehouse) {
      return NextResponse.json(
        {
          error: `${slot.supplierName} has no origin warehouse on file. Add one before printing labels.`,
        },
        { status: 400 }
      );
    }
    if (slot.missingDimSku) {
      return NextResponse.json(
        {
          error: `${slot.supplierName}'s SKU ${slot.missingDimSku} is missing weight or dimensions. Add them on the supplier dashboard, then retry.`,
        },
        { status: 400 }
      );
    }
    if (!slot.parcel || slot.parcel.weightLbs <= 0) {
      return NextResponse.json(
        {
          error: `${slot.supplierName} has no shippable items in this order.`,
        },
        { status: 400 }
      );
    }
  }

  // Buy one label per supplier shipment. Each can fail independently;
  // partial successes are persisted so the admin doesn't lose work.
  const labels: LabelRecord[] = [];
  const failures: { supplierId: string; supplierName: string; error: string }[] =
    [];
  for (const slot of slotsBySupplier.values()) {
    try {
      const shipment = await s.shipments.create({
        addressFrom: {
          name: slot.supplierName || "PartsPort Supplier",
          street1: slot.warehouse!.label || `${slot.warehouse!.city} warehouse`,
          city: slot.warehouse!.city,
          state: slot.warehouse!.state,
          zip: slot.warehouse!.zip,
          country: "US",
        },
        addressTo: {
          name: order.buyerName,
          street1: dest.street1,
          city: dest.city,
          state: dest.state,
          zip: dest.zip,
          country: dest.country,
          email: order.buyerEmail,
        },
        parcels: [
          {
            length: String(Math.max(1, slot.parcel!.lengthIn + 4)),
            width: String(Math.max(1, slot.parcel!.widthIn + 4)),
            height: String(Math.max(1, slot.parcel!.heightIn + 2)),
            distanceUnit: "in",
            weight: String(Math.max(0.1, slot.parcel!.weightLbs)),
            massUnit: "lb",
          },
        ],
        async: false,
      });
      if (!shipment.rates || shipment.rates.length === 0) {
        failures.push({
          supplierId: slot.supplierId,
          supplierName: slot.supplierName,
          error: "Shippo returned no rates for this shipment.",
        });
        continue;
      }
      const cheapest = [...shipment.rates].sort(
        (a, b) => Number(a.amount) - Number(b.amount)
      )[0];
      const transaction = await s.transactions.create({
        rate: cheapest.objectId || "",
        labelFileType: "PDF",
        async: false,
      });
      if (transaction.status !== "SUCCESS" || !transaction.labelUrl) {
        failures.push({
          supplierId: slot.supplierId,
          supplierName: slot.supplierName,
          error: `Shippo transaction failed: ${transaction.messages?.[0]?.text || "no label produced"}`,
        });
        continue;
      }
      labels.push({
        supplierId: slot.supplierId,
        supplierName: slot.supplierName,
        labelUrl: transaction.labelUrl,
        trackingNumber: transaction.trackingNumber || null,
        carrier: cheapest.provider || null,
        service:
          cheapest.servicelevel?.name || cheapest.servicelevel?.token || "Standard",
        costCents: Math.round(Number(cheapest.amount) * 100),
        transactionId: transaction.objectId || "",
      });
    } catch (err) {
      captureError(err, {
        subsystem: "freight",
        op: "label-print",
        orderId: id,
        supplierId: slot.supplierId,
      });
      failures.push({
        supplierId: slot.supplierId,
        supplierName: slot.supplierName,
        error: err instanceof Error ? err.message : "Shippo error",
      });
    }
  }

  if (labels.length === 0) {
    return NextResponse.json(
      {
        error: "No labels were produced.",
        failures,
      },
      { status: 502 }
    );
  }

  // Persist labels onto the Order. For single-shipment orders, also
  // populate the top-level carrier + trackingCode so the existing
  // /ops Mark Shipped flow continues to work without retyping.
  //
  // MED 24: write each field independently so a re-print of a partial
  // can still fill missing fields.
  const firstLabel = labels[0];
  const updateData: Prisma.OrderUpdateInput = {
    shippoLabels: labels as unknown as Prisma.InputJsonValue,
  };
  if (firstLabel.carrier && !order.carrier) {
    updateData.carrier = firstLabel.carrier;
  }
  if (firstLabel.trackingNumber && !order.trackingCode) {
    updateData.trackingCode = firstLabel.trackingNumber;
  }
  await prisma.order.update({
    where: { id },
    data: updateData,
  });

  // MED 28: audit-log every successful label purchase. One row per
  // shipment so the admin can filter /admin/audit by action.
  for (const label of labels) {
    await writeAuditLog({
      actor: user,
      action: "LABEL_PURCHASED",
      targetType: "Order",
      targetId: id,
      summary: `Printed ${label.carrier ?? "carrier"} ${label.service ?? ""} label for ${label.supplierName} on order ${order.reference} (${label.costCents} cents)`,
      metadata: {
        supplierId: label.supplierId,
        transactionId: label.transactionId,
        trackingNumber: label.trackingNumber,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    labels,
    failures: failures.length > 0 ? failures : undefined,
    reprinted: reprint,
    cachedFromPriorPrint: false,
  });
}

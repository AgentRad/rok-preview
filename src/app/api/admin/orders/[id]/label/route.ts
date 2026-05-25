import { NextResponse } from "next/server";
import { Shippo } from "shippo";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { captureError } from "@/lib/observability";

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

function parseUsAddress(shipTo: string) {
  // Best-effort parse of the buyer-typed shipTo block: pulls 2-letter
  // state + 5-digit ZIP off the end, treats the rest as the street.
  const zipMatch = shipTo.match(/\b(\d{5})(-\d{4})?\b/);
  const stateMatch = shipTo.match(/\b([A-Z]{2})\b(?=\s*\d{5})/);
  return {
    street1: shipTo.split(/\n|,/)[0]?.trim() || shipTo.slice(0, 80),
    city: "City",
    state: stateMatch?.[1] || "CA",
    zip: zipMatch?.[1] || "00000",
    country: "US",
  };
}

/**
 * Label-printing stub. POST creates a Shippo shipment + transaction (buys
 * a test label) for the order's freight and returns the label URL plus
 * the tracking number Shippo issued.
 *
 * Auto-populates Order.carrier + Order.trackingCode with the Shippo
 * tracking number when the order doesn't have one yet, so the supplier
 * can hit Mark Shipped without retyping. Test-mode labels are free; live
 * labels cost the Shippo fee.
 */
export async function POST(
  _req: Request,
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

  // Aggregate parcel from the order items. Reuses the freight-lib shape.
  let totalWeight = 0;
  let maxLength = 0;
  let maxWidth = 0;
  let maxHeight = 0;
  let missingDims = false;
  for (const item of order.items) {
    const p = item.product;
    if (
      p.weightLbs == null ||
      p.lengthIn == null ||
      p.widthIn == null ||
      p.heightIn == null
    ) {
      missingDims = true;
      continue;
    }
    totalWeight += p.weightLbs * item.qty;
    maxLength = Math.max(maxLength, p.lengthIn);
    maxWidth = Math.max(maxWidth, p.widthIn);
    maxHeight = Math.max(maxHeight, p.heightIn * Math.min(item.qty, 3));
  }
  if (missingDims || totalWeight <= 0) {
    return NextResponse.json(
      {
        error:
          "At least one item is missing weight or dimensions. Add them on the supplier dashboard, then retry.",
      },
      { status: 400 }
    );
  }
  const firstSupplier = order.items[0]?.product.supplier;
  const warehouse =
    firstSupplier?.warehouses.find((w) => w.isDefault) ||
    firstSupplier?.warehouses[0];
  if (!warehouse) {
    return NextResponse.json(
      {
        error:
          "Supplier has no origin warehouse on file. Add one before printing labels.",
      },
      { status: 400 }
    );
  }
  const dest = parseUsAddress(order.shipTo);

  try {
    const shipment = await s.shipments.create({
      addressFrom: {
        name: firstSupplier?.name || "PartsPort Supplier",
        street1: warehouse.label || `${warehouse.city} warehouse`,
        city: warehouse.city,
        state: warehouse.state,
        zip: warehouse.zip,
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
          length: String(Math.max(1, maxLength + 4)),
          width: String(Math.max(1, maxWidth + 4)),
          height: String(Math.max(1, maxHeight + 2)),
          distanceUnit: "in",
          weight: String(Math.max(0.1, totalWeight)),
          massUnit: "lb",
        },
      ],
      async: false,
    });
    if (!shipment.rates || shipment.rates.length === 0) {
      return NextResponse.json(
        { error: "Shippo returned no rates for this shipment." },
        { status: 502 }
      );
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
      return NextResponse.json(
        {
          error: `Shippo transaction failed: ${transaction.messages?.[0]?.text || "no label produced"}`,
        },
        { status: 502 }
      );
    }
    // Persist the carrier + tracking back onto the Order if not set, so
    // the supplier doesn't have to retype it before Mark Shipped.
    if (!order.carrier && transaction.trackingNumber) {
      await prisma.order.update({
        where: { id },
        data: {
          carrier: cheapest.provider || "Shippo",
          trackingCode: transaction.trackingNumber,
        },
      });
    }
    return NextResponse.json({
      ok: true,
      labelUrl: transaction.labelUrl,
      trackingNumber: transaction.trackingNumber || null,
      carrier: cheapest.provider || null,
      service:
        cheapest.servicelevel?.name ||
        cheapest.servicelevel?.token ||
        "Standard",
      costCents: Math.round(Number(cheapest.amount) * 100),
    });
  } catch (err) {
    captureError(err, {
      subsystem: "freight",
      op: "label-print",
      orderId: id,
    });
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Shippo error: ${err.message}`
            : "Shippo error during label creation.",
      },
      { status: 502 }
    );
  }
}

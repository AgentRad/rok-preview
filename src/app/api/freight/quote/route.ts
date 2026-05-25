import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import {
  getFreightRates,
  isShippoConfigured,
  surchargeCents,
  type FreightSurcharges,
} from "@/lib/freight";

export const runtime = "nodejs";

type CartLine = { sku: string; qty: number };

type ShipmentQuote = {
  supplierId: string;
  supplierName: string;
  originZip: string;
  originCity: string;
  originState: string;
  /** Best (cheapest) rate that came back, ready to use as default. */
  best: {
    carrier: string;
    service: string;
    cents: number;
    etaDays: number | null;
    rateId: string | null;
  } | null;
  /** Full rate list (top 5). Empty when Shippo not configured or dims missing. */
  rates: {
    carrier: string;
    service: string;
    cents: number;
    etaDays: number | null;
    rateId: string | null;
  }[];
  /**
   * Reason the best is null when it is. Surfaced inline so the checkout
   * client can render a useful message ("Missing dimensions on X"
   * vs. "Live quotes not configured").
   */
  fallbackReason?: string;
};

/**
 * Checkout-time freight quote across all suppliers in a cart. Splits
 * the cart by supplier, asks Shippo for rates against each supplier's
 * default warehouse, and returns a per-supplier ShipmentQuote slot.
 *
 * Total cents = sum of selected rate per shipment + surcharge cents.
 * Caller (CheckoutClient) renders one rate-picker per shipment.
 */
export async function POST(req: Request) {
  const limit = await rateLimit("freight-estimate", clientIp(req));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Please wait before requesting another quote." },
      { status: 429 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const items: CartLine[] = Array.isArray(body.items) ? body.items : [];
  const destZip = String(body.destZip || "").trim();
  if (!/^\d{5}/.test(destZip)) {
    return NextResponse.json(
      { error: "Provide a 5-digit destination ZIP." },
      { status: 400 }
    );
  }
  if (items.length === 0) {
    return NextResponse.json(
      { error: "Cart is empty." },
      { status: 400 }
    );
  }
  const surcharges: FreightSurcharges = {
    liftgate: !!body.surcharges?.liftgate,
    residential: !!body.surcharges?.residential,
    insideDelivery: !!body.surcharges?.insideDelivery,
  };

  // Pull each SKU + its supplier + supplier's default warehouse in one round.
  const products = await prisma.product.findMany({
    where: { sku: { in: items.map((i) => String(i.sku)) }, active: true },
    include: {
      supplier: {
        include: {
          warehouses: { orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] },
        },
      },
    },
  });
  const bySku = new Map(products.map((p) => [p.sku, p]));

  // Group cart lines by supplier id, accumulating items for Shippo.
  type Group = {
    supplierId: string;
    supplierName: string;
    originZip: string;
    originCity: string;
    originState: string;
    items: { sku: string; qty: number }[];
    items_full: {
      qty: number;
      weightLbs: number | null;
      lengthIn: number | null;
      widthIn: number | null;
      heightIn: number | null;
    }[];
  };
  const groups = new Map<string, Group>();
  for (const line of items) {
    const p = bySku.get(String(line.sku));
    if (!p) continue;
    const qty = Math.max(1, Math.floor(Number(line.qty) || 1));
    const warehouse =
      p.supplier.warehouses.find((w) => w.isDefault) ||
      p.supplier.warehouses[0];
    const supplierId = p.supplier.id;
    if (!groups.has(supplierId)) {
      groups.set(supplierId, {
        supplierId,
        supplierName: p.supplier.name,
        originZip: warehouse?.zip || "",
        originCity: warehouse?.city || "",
        originState: warehouse?.state || "",
        items: [],
        items_full: [],
      });
    }
    const group = groups.get(supplierId)!;
    group.items.push({ sku: p.sku, qty });
    group.items_full.push({
      qty,
      weightLbs: p.weightLbs,
      lengthIn: p.lengthIn,
      widthIn: p.widthIn,
      heightIn: p.heightIn,
    });
  }

  const configured = isShippoConfigured();
  const shipments: ShipmentQuote[] = [];
  for (const group of groups.values()) {
    let rates: ShipmentQuote["rates"] = [];
    let fallbackReason: string | undefined;
    if (!configured) {
      fallbackReason = "Live freight quotes not configured.";
    } else if (!group.originZip) {
      fallbackReason = `${group.supplierName} hasn't registered an origin warehouse.`;
    } else if (
      group.items_full.some(
        (it) =>
          it.weightLbs == null ||
          it.lengthIn == null ||
          it.widthIn == null ||
          it.heightIn == null
      )
    ) {
      fallbackReason = `Some ${group.supplierName} items are missing weight or dimensions; rate falls back to flat ground.`;
    } else {
      rates = await getFreightRates({
        originZip: group.originZip,
        destZip,
        items: group.items_full,
      });
    }
    shipments.push({
      supplierId: group.supplierId,
      supplierName: group.supplierName,
      originZip: group.originZip,
      originCity: group.originCity,
      originState: group.originState,
      best: rates[0] || null,
      rates,
      fallbackReason,
    });
  }

  const ratesTotalCents = shipments.reduce(
    (sum, s) => sum + (s.best?.cents ?? 0),
    0
  );
  return NextResponse.json({
    ok: true,
    shippoConfigured: configured,
    shipments,
    surchargeCents: surchargeCents(surcharges),
    /**
     * Convenience: if every shipment got a rate, this is the freight
     * total. Mixed cases (some shipments rate, some flat fallback)
     * are flagged via fallbackReason; the client adds the flat number
     * itself.
     */
    ratesTotalCents,
  });
}

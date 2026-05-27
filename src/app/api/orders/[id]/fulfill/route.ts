import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canFulfillOrders,
  getActiveSupplierContext,
  userHasAccessToSupplier,
} from "@/lib/supplier-access";
import { markOrderShipped, markSlotShipped } from "@/lib/shipping";

export const runtime = "nodejs";

/**
 * Supplier (or admin) marks shipment Shipped.
 *
 * PLH-3g P8: scoped to the caller's OWN OrderSupplierSlot. For SUPPLIER
 * callers we resolve the active supplier context and locate that
 * supplier's slot on the order; we never ship another supplier's slot.
 * Admins can pass an explicit `slotId` (preferred) or fall back to the
 * legacy whole-order ship via markOrderShipped.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    carrier?: string;
    trackingCode?: string;
    slotId?: string;
  } | null;
  const carrier = body?.carrier ?? "";
  const trackingCode = body?.trackingCode ?? "";

  if (user.role === "SUPPLIER") {
    const ctx = await getActiveSupplierContext(user);
    if (!ctx || !canFulfillOrders(ctx.role)) {
      return NextResponse.json(
        { error: "Your role on this order doesn't allow shipping." },
        { status: 403 }
      );
    }
    const supplierId = ctx.supplier.id;
    // Locate THIS supplier's slot on the order. If none, this supplier
    // has nothing to ship on this order: 403.
    const slot = await prisma.orderSupplierSlot.findUnique({
      where: { orderId_supplierId: { orderId: id, supplierId } },
      select: { id: true },
    });
    if (!slot) {
      return NextResponse.json(
        { error: "You have no shipment on this order." },
        { status: 403 }
      );
    }
    const result = await markSlotShipped(slot.id, { carrier, trackingCode });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  }

  // ADMIN: ship a specific slot if slotId given, else ship the whole order.
  if (body?.slotId) {
    const slot = await prisma.orderSupplierSlot.findUnique({
      where: { id: body.slotId },
      select: { id: true, orderId: true, supplierId: true },
    });
    if (!slot || slot.orderId !== id) {
      return NextResponse.json(
        { error: "Shipment slot not found on this order." },
        { status: 404 }
      );
    }
    // Defensive: admin acting-as a supplier must still have access.
    const ctx = await getActiveSupplierContext(user);
    if (ctx?.actingAsAdmin && ctx.supplier.id !== slot.supplierId) {
      const check = await userHasAccessToSupplier(user.id, slot.supplierId);
      if (!check.ok) {
        return NextResponse.json(
          { error: "No access to this supplier's slot." },
          { status: 403 }
        );
      }
    }
    const result = await markSlotShipped(slot.id, { carrier, trackingCode });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  }

  const result = await markOrderShipped(id, carrier, trackingCode);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}

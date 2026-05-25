import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  canFulfillOrders,
  userHasAccessToSupplier,
} from "@/lib/supplier-access";
import { markOrderShipped } from "@/lib/shipping";

export const runtime = "nodejs";

/**
 * Supplier marks an order Shipped. Requires carrier + trackingCode (same as
 * the admin ops console). Sets shipmentStage = "Shipped", emits the shipped
 * email, and creates the supplier payout via the shared markOrderShipped
 * helper. Does NOT flip status to FULFILLED on its own; Delivered happens
 * later (admin advance, buyer confirm-receipt, or the 14-day auto-deliver
 * cron).
 *
 * Authorization: SUPPLIER members whose team role can fulfill, OR ADMIN.
 * For suppliers, the user must have access to every supplier on the order's
 * line items (in practice a single-supplier order today, but defensive).
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
    include: { items: { include: { product: true } } },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (user.role === "SUPPLIER") {
    const supplierIds = Array.from(
      new Set(order.items.map((i) => i.product.supplierId))
    );
    const checks = await Promise.all(
      supplierIds.map((sid) => userHasAccessToSupplier(user.id, sid))
    );
    const allowed = checks.every((c) => c.ok && canFulfillOrders(c.role));
    if (!allowed) {
      return NextResponse.json(
        { error: "Your role on this order doesn't allow shipping." },
        { status: 403 }
      );
    }
  }
  const body = (await req.json().catch(() => null)) as {
    carrier?: string;
    trackingCode?: string;
  } | null;
  const result = await markOrderShipped(
    id,
    body?.carrier ?? "",
    body?.trackingCode ?? ""
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}

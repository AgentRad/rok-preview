import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { markOrderPaid } from "@/lib/order-utils";
import { maybeReactivateOrg } from "@/lib/dunning";

export const runtime = "nodejs";

const VALID_METHODS = ["ach", "wire", "check", "card", "other"];

/**
 * PLH-3z-2: manual mark-paid for off-platform net-terms payments (a buyer
 * wires direct to PartsPort's bank or pays by check despite Stripe Invoices
 * being live). Inserts a PaymentRecord (source manual_admin) and, once the
 * running sum of payments clears the invoice total, flips the invoice PAID and
 * runs markOrderPaid so the P8 payout flow + QBO sync fire. A partial payment
 * leaves the invoice open with partialPaidCents incremented.
 *
 * `id` is the Invoice id.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const dollars = Number(body.amountDollars);
  if (!Number.isFinite(dollars) || dollars <= 0) {
    return NextResponse.json(
      { error: "amountDollars must be a positive number." },
      { status: 400 }
    );
  }
  const amountCents = Math.round(dollars * 100);

  const method = String(body.method || "").toLowerCase();
  if (!VALID_METHODS.includes(method)) {
    return NextResponse.json(
      { error: "method must be one of ach, wire, check, card, other." },
      { status: 400 }
    );
  }

  let receivedAt = new Date();
  if (body.receivedAt) {
    const d = new Date(String(body.receivedAt));
    if (!Number.isNaN(d.getTime())) receivedAt = d;
  }
  const reference = String(body.reference || "").slice(0, 200);
  const notes = String(body.notes || "").slice(0, 1000);

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { order: { select: { id: true, buyerOrgId: true } } },
  });
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }
  if (invoice.status === "PAID") {
    return NextResponse.json(
      { error: "Invoice is already paid." },
      { status: 409 }
    );
  }

  const newPartial = invoice.partialPaidCents + amountCents;
  const clearsInvoice = newPartial >= invoice.totalCents;

  await prisma.$transaction(async (tx) => {
    await tx.paymentRecord.create({
      data: {
        invoiceId: invoice.id,
        amountCents,
        receivedAt,
        method,
        reference,
        source: "manual_admin",
        recordedBy: user.id,
        notes,
      },
    });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        partialPaidCents: newPartial,
        ...(clearsInvoice
          ? {
              status: "PAID",
              paidAt: new Date(),
              paidReference: reference || `manual:${method}`,
              paymentMethod: method,
            }
          : {}),
      },
    });
  });

  // When the payment clears the balance, advance the order through the same
  // markOrderPaid path prepaid orders use (idempotent; only acts on PENDING).
  if (clearsInvoice && invoice.order) {
    await markOrderPaid(invoice.order.id, method);
    // PLH-3z-4: clearing the balance may reactivate a suspended org.
    await maybeReactivateOrg(invoice.order.buyerOrgId);
  }

  await writeAuditLog({
    actor: user,
    action: "INVOICE_PAYMENT_RECORDED",
    targetType: "Invoice",
    targetId: invoice.id,
    summary: `Manual payment of $${(amountCents / 100).toFixed(2)} (${method}) recorded on invoice ${invoice.number}.${clearsInvoice ? " Invoice now PAID." : ""}`,
    metadata: {
      amountCents,
      method,
      reference,
      partialPaidCents: newPartial,
      clearedInvoice: clearsInvoice,
    },
  });

  return NextResponse.json({
    ok: true,
    invoiceId: invoice.id,
    partialPaidCents: newPartial,
    status: clearsInvoice ? "PAID" : invoice.status,
  });
}

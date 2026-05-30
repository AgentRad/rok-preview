import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { markOrderPaid } from "@/lib/order-utils";
import { maybeReactivateOrg } from "@/lib/dunning";
import { clearsInvoice } from "@/lib/route-guards";

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

  // QA2 BUG 1 (lost update). The old code read partialPaidCents OUTSIDE the
  // transaction and wrote `newPartial` as a blind `set`, so two concurrent
  // admin POSTs both read the same starting value and the second `set`
  // clobbered the first, losing a payment from the running total. The fix:
  // do the running-total math as an atomic `{ increment }` INSIDE one
  // transaction, re-read the fresh post-increment row to decide whether the
  // invoice clears, and flip PAID with a `status != PAID` guard so exactly
  // one concurrent caller owns the markOrderPaid advance.
  const result = await prisma.$transaction(async (tx) => {
    // Re-read inside the tx: a concurrent request may have flipped the
    // invoice PAID between our top-level findUnique and here.
    const current = await tx.invoice.findUnique({
      where: { id: invoice.id },
      select: { status: true },
    });
    if (!current || current.status === "PAID") {
      return { alreadyPaid: true, partialPaidCents: 0, cleared: false, didClear: false };
    }

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

    const updated = await tx.invoice.update({
      where: { id: invoice.id },
      data: { partialPaidCents: { increment: amountCents } },
      select: { partialPaidCents: true, totalCents: true },
    });

    const cleared = clearsInvoice(updated.partialPaidCents, updated.totalCents);
    let didClear = false;
    if (cleared) {
      // Flip PAID only on the DUE/PARTIAL -> PAID transition. updateMany with
      // a `status != PAID` filter returns count, so under row-serialized
      // concurrent txns exactly one caller sees count > 0 and triggers the
      // single markOrderPaid advance below. A still-partial payment never
      // reaches this branch and leaves the invoice open.
      const flip = await tx.invoice.updateMany({
        where: { id: invoice.id, status: { not: "PAID" } },
        data: {
          status: "PAID",
          paidAt: new Date(),
          paidReference: reference || `manual:${method}`,
          paymentMethod: method,
        },
      });
      didClear = flip.count > 0;
    }

    return {
      alreadyPaid: false,
      partialPaidCents: updated.partialPaidCents,
      cleared,
      didClear,
    };
  });

  if (result.alreadyPaid) {
    return NextResponse.json(
      { error: "Invoice is already paid." },
      { status: 409 }
    );
  }

  // When this payment is the one that cleared the balance, advance the order
  // through the same markOrderPaid path prepaid orders use (idempotent; only
  // acts on PENDING). The didClear guard ensures it fires exactly once even
  // under concurrent clearing payments.
  if (result.didClear && invoice.order) {
    await markOrderPaid(invoice.order.id, method);
    // PLH-3z-4: clearing the balance may reactivate a suspended org.
    await maybeReactivateOrg(invoice.order.buyerOrgId);
  }

  await writeAuditLog({
    actor: user,
    action: "INVOICE_PAYMENT_RECORDED",
    targetType: "Invoice",
    targetId: invoice.id,
    summary: `Manual payment of $${(amountCents / 100).toFixed(2)} (${method}) recorded on invoice ${invoice.number}.${result.cleared ? " Invoice now PAID." : ""}`,
    metadata: {
      amountCents,
      method,
      reference,
      partialPaidCents: result.partialPaidCents,
      clearedInvoice: result.cleared,
    },
  });

  return NextResponse.json({
    ok: true,
    invoiceId: invoice.id,
    partialPaidCents: result.partialPaidCents,
    status: result.cleared ? "PAID" : invoice.status,
  });
}

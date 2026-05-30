import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { dollarsToCents } from "@/lib/money";
import { sendQuoteReady } from "@/lib/email";
import {
  canRespondToQuotes,
  userHasAccessToSupplier,
} from "@/lib/supplier-access";
import { captureError } from "@/lib/observability";
import { writeAuditLog } from "@/lib/audit";
import { sendQuoteDeclined } from "@/lib/email";
import { quoteDeclineGuard } from "@/lib/route-guards";

const QUOTE_VALID_DAYS = 30;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const quote = await prisma.quoteRequest.findUnique({
    where: { id },
    include: { product: { include: { supplier: true } } },
  });
  if (!quote) {
    return NextResponse.json({ error: "Quote not found." }, { status: 404 });
  }
  if (quote.status === "ACCEPTED") {
    return NextResponse.json(
      { error: "This quote has already been accepted." },
      { status: 400 }
    );
  }

  if (b.action === "decline") {
    // BUG 2 fix. The decline branch previously mutated the quote and emailed
    // the buyer with NO authorization (getCurrentUser was only read for the
    // audit actor). Require an authenticated owner / ADMIN / product-supplier
    // before any state change. Mirrors the sibling "quote" action below.
    const actor = await getCurrentUser();
    // BUG 3 fix. Mirror the "quote" (price) action's supplier gate: a
    // supplier-team member may decline only if their role canRespondToQuotes
    // AND the supplier is APPROVED && publicVisible. The quote owner and
    // platform admin bypass this (handled inside quoteDeclineGuard).
    let supplierAccess: { roleCanRespond: boolean; supplierActive: boolean } | null = null;
    if (actor?.role === "SUPPLIER") {
      const access = await userHasAccessToSupplier(actor.id, quote.product.supplierId);
      if (access.ok) {
        const supplier = quote.product.supplier;
        supplierAccess = {
          roleCanRespond: canRespondToQuotes(access.role),
          supplierActive: supplier.status === "APPROVED" && supplier.publicVisible,
        };
      }
    }
    const guard = quoteDeclineGuard({ user: actor, quote, supplierAccess });
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }

    const updated = await prisma.quoteRequest.update({
      where: { id },
      data: { status: "DECLINED" },
      include: { product: { include: { supplier: true } } },
    });
    await writeAuditLog({
      actor: { id: actor?.id || "system", email: actor?.email || "system@partsport" },
      action: "QUOTE_DECLINED",
      targetType: "QuoteRequest",
      targetId: updated.id,
      summary: `Quote ${updated.reference} declined.`,
      metadata: { quoteReference: updated.reference, productSku: updated.product.sku },
    });
    after(async () => {
      try {
        await sendQuoteDeclined({
          id: updated.id,
          reference: updated.reference,
          buyerName: updated.buyerName,
          buyerEmail: updated.buyerEmail,
          qty: updated.qty,
          message: updated.message,
          productName: updated.product.name,
          productSku: updated.product.sku,
          supplierName: updated.product.supplier.name,
          quotedUnitCents: updated.quotedUnitCents,
          quoteNote: updated.quoteNote,
        });
      } catch (err) {
        captureError(err, { subsystem: "email", op: "quote-declined", quoteId: updated.id });
      }
    });
    return NextResponse.json({ ok: true });
  }

  if (b.action === "quote") {
    const user = await getCurrentUser();
    if (user && !user.emailVerified && user.role !== "ADMIN") {
      return NextResponse.json(
        {
          error:
            "Verify your email before responding to RFQs. Request a new verification link from /account.",
          code: "EMAIL_NOT_VERIFIED",
        },
        { status: 403 }
      );
    }
    if (!user || (user.role !== "SUPPLIER" && user.role !== "ADMIN")) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }
    if (user.role === "SUPPLIER") {
      const access = await userHasAccessToSupplier(
        user.id,
        quote.product.supplierId
      );
      if (!access.ok) {
        return NextResponse.json(
          { error: "Not your product." },
          { status: 403 }
        );
      }
      if (!canRespondToQuotes(access.role)) {
        return NextResponse.json(
          {
            error: "Your role doesn't allow responding to RFQs.",
          },
          { status: 403 }
        );
      }
      const supplier = quote.product.supplier;
      if (supplier.status !== "APPROVED" || !supplier.publicVisible) {
        return NextResponse.json(
          { error: "Your supplier account is not active. Contact support to reactivate." },
          { status: 403 }
        );
      }
    }
    const price = Number(b.unitPrice);
    if (!(price > 0)) {
      return NextResponse.json(
        { error: "A unit price is required." },
        { status: 400 }
      );
    }
    const expiresAt = new Date(Date.now() + QUOTE_VALID_DAYS * 24 * 60 * 60 * 1000);
    const updated = await prisma.quoteRequest.update({
      where: { id },
      data: {
        quotedUnitCents: dollarsToCents(price),
        quoteNote: String(b.note || "").trim(),
        status: "QUOTED",
        quotedAt: new Date(),
        quoteExpiresAt: expiresAt,
      },
      include: { product: { include: { supplier: true } } },
    });
    await writeAuditLog({
      actor: user,
      action: "QUOTE_PRICED",
      targetType: "QuoteRequest",
      targetId: updated.id,
      summary: `Quote ${updated.reference} priced at ${dollarsToCents(price)} cents/unit (expires ${expiresAt.toISOString().slice(0, 10)}).`,
      metadata: {
        quoteReference: updated.reference,
        productSku: updated.product.sku,
        quotedUnitCents: dollarsToCents(price),
        expiresAt: expiresAt.toISOString(),
      },
    });
    after(async () => {
      try {
        await sendQuoteReady({
          id: updated.id,
          reference: updated.reference,
          buyerName: updated.buyerName,
          buyerEmail: updated.buyerEmail,
          qty: updated.qty,
          message: updated.message,
          productName: updated.product.name,
          productSku: updated.product.sku,
          supplierName: updated.product.supplier.name,
          quotedUnitCents: updated.quotedUnitCents,
          quoteNote: updated.quoteNote,
        });
      } catch (err) {
        captureError(err, { subsystem: "email", op: "quote-ready", quoteId: updated.id });
      }
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
